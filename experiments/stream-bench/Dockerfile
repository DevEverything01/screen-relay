ARG BASE_IMAGE=debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
FROM ${BASE_IMAGE}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       build-essential pkg-config libx11-dev libxext-dev libxdamage-dev libxfixes-dev libxtst-dev \
       libavcodec-dev libavutil-dev libswscale-dev libwebsockets-dev xvfb xauth x11-utils \
       libx264-dev libopenh264-dev python3 python3-numpy python3-websockets ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY workload.c bench.py /bench/
RUN cc -O2 -Wall -o /bench/workload /bench/workload.c -lX11 -lXext -lm
ENTRYPOINT ["python3", "/bench/bench.py"]
