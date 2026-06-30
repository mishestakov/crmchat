# Образ суточного синка «Каналы Яндекса» (platform_active_sync.py).
# Oneshot: запускается планировщиком хоста через `docker compose run --rm`,
# отрабатывает и умирает. В compose-сети → дотягивается до postgres:5432.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY platform_active_sync.py .

ENTRYPOINT ["python", "platform_active_sync.py"]
