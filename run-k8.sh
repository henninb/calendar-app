#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# run-k8.sh — Build and deploy calendar-app to Kubernetes
# -----------------------------------------------------------------------------
# Prerequisites:
#   - kubectl configured and pointing at your cluster
#   - SSH access to the worker node (debian-k8s-worker-01)
#   - Docker or Podman available for building the image
#   - gopass with entries for:
#       postgresql.bhenning.com/username
#       postgresql.bhenning.com/password
#       gmail/brian.henning/client_id
#       gmail/brian.henning/client_secret
#
# Storage strategy: hostPath volume on debian-k8s-worker-01
#   /opt/calendar-app/token/  — Google OAuth token (persists across restarts)
#
# Note: subPath file mounts (PVC) are broken on this cluster's runc version;
#       hostPath is used instead and the pod is pinned to the worker.
# -----------------------------------------------------------------------------

APP_NAME="calendar-app"
NAMESPACE="default"
IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
IMAGE="${APP_NAME}:${IMAGE_TAG}"
WORKER_NODE="debian-k8s-worker-01"
HOST_DATA_DIR="/opt/calendar-app"

# --- helpers -----------------------------------------------------------------

info()  { echo "[INFO]  $*"; }
die()   { echo "[ERROR] $*" >&2; exit 1; }

require_cmd() { command -v "$1" &>/dev/null || die "'$1' is required but not found in PATH"; }

# --- preflight ---------------------------------------------------------------

require_cmd kubectl
require_cmd gopass
command -v docker &>/dev/null || command -v podman &>/dev/null || die "docker or podman is required"

# --- build image -------------------------------------------------------------

info "Building Docker image: $IMAGE (tag: $IMAGE_TAG)"
if command -v docker &>/dev/null; then
    docker build --network=host -f Containerfile -t "$IMAGE" .
else
    podman build --network=host -f Containerfile -t "$IMAGE" .
fi

# Load image into the cluster nodes via containerd (no registry needed).
info "Importing image into cluster nodes via containerd"
if command -v docker &>/dev/null; then
    docker save "$IMAGE" | ssh debian-k8s-cp-01  "sudo ctr -n k8s.io images import -"
    docker save "$IMAGE" | ssh "$WORKER_NODE"    "sudo ctr -n k8s.io images import -"
else
    podman save "$IMAGE" | ssh debian-k8s-cp-01  "sudo ctr -n k8s.io images import -"
    podman save "$IMAGE" | ssh "$WORKER_NODE"    "sudo ctr -n k8s.io images import -"
fi

# --- read secrets ------------------------------------------------------------

info "Reading credentials from gopass"
DB_USERNAME=$(gopass show -o postgresql.bhenning.com/username)
DB_PASSWORD=$(gopass show -o postgresql.bhenning.com/password)
GOOGLE_CLIENT_ID=$(gopass show -o gmail/brian.henning/client_id)
GOOGLE_CLIENT_SECRET=$(gopass show -o gmail/brian.henning/client_secret)
API_KEY=$(gopass show -o calendar.bhenning.com/api_key)

# --- prepare hostPath dirs on the worker ------------------------------------

info "Creating hostPath directories on $WORKER_NODE..."
ssh "$WORKER_NODE" "
    sudo mkdir -p ${HOST_DATA_DIR}/token &&
    sudo chown -R 1000:1000 ${HOST_DATA_DIR}
"

# --- apply manifests ---------------------------------------------------------

info "Applying Kubernetes manifests to namespace: $NAMESPACE"

kubectl apply -f - <<EOF
---
apiVersion: v1
kind: Namespace
metadata:
  name: $NAMESPACE

---
apiVersion: v1
kind: Secret
metadata:
  name: ${APP_NAME}-credentials
  namespace: $NAMESPACE
type: Opaque
stringData:
  DB_USERNAME: "$DB_USERNAME"
  DB_PASSWORD: "$DB_PASSWORD"
  GOOGLE_CLIENT_ID: "$GOOGLE_CLIENT_ID"
  GOOGLE_CLIENT_SECRET: "$GOOGLE_CLIENT_SECRET"
  API_KEY: "$API_KEY"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $APP_NAME
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
spec:
  replicas: 1
  selector:
    matchLabels:
      app: $APP_NAME
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: $APP_NAME
    spec:
      securityContext:
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      dnsPolicy: None
      dnsConfig:
        nameservers:
          - 192.168.10.1
        searches:
          - default.svc.cluster.local
          - svc.cluster.local
          - cluster.local
      nodeSelector:
        kubernetes.io/hostname: $WORKER_NODE
      containers:
        - name: $APP_NAME
          image: $IMAGE
          imagePullPolicy: Never
          env:
            - name: DB_HOST
              value: "postgresql.bhenning.com"
            - name: DB_PORT
              value: "5432"
            - name: DB_NAME
              value: "calendar_db"
            - name: DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: ${APP_NAME}-credentials
                  key: DB_USERNAME
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${APP_NAME}-credentials
                  key: DB_PASSWORD
            - name: GOOGLE_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: ${APP_NAME}-credentials
                  key: GOOGLE_CLIENT_ID
            - name: GOOGLE_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${APP_NAME}-credentials
                  key: GOOGLE_CLIENT_SECRET
            - name: API_KEY
              valueFrom:
                secretKeyRef:
                  name: ${APP_NAME}-credentials
                  key: API_KEY
            - name: GOOGLE_REDIRECT_URI
              value: "https://calendar.bhenning.com/api/sync/auth/callback"
            - name: GOOGLE_TOKEN_FILE
              value: "/token/token.json"
            - name: TZ
              value: "America/Chicago"
          ports:
            - containerPort: 8000
              name: http
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 60
            timeoutSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 15
            periodSeconds: 30
            timeoutSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          volumeMounts:
            - name: token
              mountPath: /token
      volumes:
        - name: token
          hostPath:
            path: ${HOST_DATA_DIR}/token
            type: DirectoryOrCreate

---
apiVersion: v1
kind: Service
metadata:
  name: $APP_NAME
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
spec:
  selector:
    app: $APP_NAME
  ports:
    - name: http
      port: 8000
      targetPort: 8000
  type: ClusterIP
EOF

# --- force rollout -----------------------------------------------------------

info "Restarting deployment to pick up new image (${IMAGE})..."
kubectl rollout restart deployment/"$APP_NAME" -n "$NAMESPACE"

# --- wait for rollout --------------------------------------------------------

info "Waiting for rollout to complete..."
kubectl rollout status deployment/"$APP_NAME" -n "$NAMESPACE" --timeout=120s

info "Deployment complete. Pod status:"
kubectl get pods -n "$NAMESPACE" -o wide

info ""
info "To view logs:    kubectl logs -n $NAMESPACE -l app=$APP_NAME -f"
info "To access app:   kubectl port-forward -n $NAMESPACE svc/$APP_NAME 8000:8000"
info "                 then: curl http://localhost:8000"
info "Token on worker: ssh $WORKER_NODE ls -la $HOST_DATA_DIR/token"
