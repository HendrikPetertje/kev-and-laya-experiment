FROM python:3.12-slim

ARG LAYA_VERSION=0.3.22

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/data/hf \
    LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_DEVICE=cpu

# CPU-only torch (Podman on macOS has no CUDA); avoids pulling ~3GB of CUDA wheels.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install "laya[serve]==${LAYA_VERSION}"

RUN useradd -m -u 1000 laya && mkdir -p /data/hf && chown -R laya /data
USER laya
WORKDIR /home/laya

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"LAYA_PORT\"]}/health',timeout=4)"

CMD ["laya-serve"]
