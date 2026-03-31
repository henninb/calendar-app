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
COPY frontend/package*.json ./frontend/
RUN npm install -g npm@11.12.1 && \
    cd frontend && npm install

# Application source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

COPY container-entrypoint.sh ./
RUN chmod +x container-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/container-entrypoint.sh"]
