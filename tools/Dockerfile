# The collector's service on Fly.io (fly.toml, runner.py; ADR 0012). Secrets come from
# `fly secrets`, never from this image: .dockerignore lets in only the scripts and their deps.
FROM python:3.11-slim
WORKDIR /app
COPY requirements-steampy.txt ./
RUN pip install --no-cache-dir -r requirements-steampy.txt
COPY *.py ./
ENV PYTHONUNBUFFERED=1
# Python itself is PID 1, so Fly's stop signal reaches the service directly.
CMD ["python", "runner.py"]
