FROM python:3.12-slim

# git dibutuhkan untuk worktree isolasi mode otonom (PRD §8)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    "fastapi>=0.115" "uvicorn[standard]>=0.32" "sqlalchemy[asyncio]>=2.0.36" \
    "asyncpg>=0.30" "pydantic>=2.9" "pydantic-settings>=2.6" "httpx>=0.27" \
    "python-multipart>=0.0.12" "itsdangerous>=2.2" "passlib[bcrypt]>=1.7.4"

COPY app ./app
COPY migrations ./migrations
COPY scripts ./scripts

# CATATAN: harness agent (claude, agy, opencode) TIDAK dipasang di image ini.
# Masing-masing terikat pada login langganan milikmu di host. Pasang di image
# hanya kalau kamu memang menjalankan seluruh alur di dalam container, dan
# tetap login lewat channel resmi tiap layanan.

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
