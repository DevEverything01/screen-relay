ARG BASE_IMAGE=debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
FROM ${BASE_IMAGE}

COPY . /opt/relay-src
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && cd /opt/relay-src \
    && npm ci \
    && npm run typecheck \
    && npm test \
    && /opt/relay-src/install.sh --prefix /usr/local \
    && apt-get install -y --no-install-recommends libavcodec-dev libavutil-dev libswscale-dev \
    && make -C /opt/relay-src test clean \
    && rm -rf /opt/relay-src /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash relay \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

USER relay
WORKDIR /home/relay
EXPOSE 8080
ENTRYPOINT ["tini", "--", "relay", "up", "--bind", "0.0.0.0"]
