FROM python:3.14-slim

# Install Node.js 22 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates build-essential libpq-dev && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Python dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r backend/requirements.txt

# Node dependencies
COPY frontend-nextgen/package*.json ./frontend-nextgen/
RUN cd frontend-nextgen && npm ci

# Application source
COPY backend/ ./backend/
COPY frontend-nextgen/ ./frontend-nextgen/

# Build Next.js for production (BACKEND_PORT baked in as default; overridable at runtime)
ARG BACKEND_PORT=9000
RUN cd frontend-nextgen && BACKEND_PORT=${BACKEND_PORT} npm run build

COPY container-entrypoint.sh ./
RUN chmod +x container-entrypoint.sh && \
    chown -R 1000:1000 /app

USER 1000

EXPOSE 8000

ENTRYPOINT ["/app/container-entrypoint.sh"]
