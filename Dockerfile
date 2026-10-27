ARG BASE_IMAGE=debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
FROM ${BASE_IMAGE}

USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    xfce4 dbus-x11 at-spi2-core xvfb xauth x11-utils x11-xserver-utils xdotool \
    python3 python3-tk python3-pil fonts-dejavu-core procps iproute2 pulseaudio scrot \
    libavcodec-dev libavutil-dev libswscale-dev \
    build-essential pkg-config libx11-dev libxext-dev libxdamage-dev \
    libxfixes-dev libxtst-dev libwebsockets-dev
RUN id -u bench >/dev/null 2>&1 || useradd --create-home --shell /bin/bash bench
RUN mkdir -p /opt/bench /home/bench/.vnc /home/bench/runtime /tmp/.X11-unix \
    && chown -R bench:bench /home/bench /opt/bench \
    && chmod 700 /home/bench/runtime \
    && chmod 1777 /tmp/.X11-unix

WORKDIR /opt/native-src
ARG BUILD_FLAGS="-O2 -std=c++17 -Wall -Wextra -Wpedantic -pthread"
COPY src/ ./src/
COPY viewer/ ./viewer/
COPY tests/color-test.cpp ./tests/color-test.cpp
COPY tests/flow-test.cpp ./tests/flow-test.cpp
COPY tests/backend-source-test.cpp ./tests/backend-source-test.cpp
COPY Makefile ./Makefile
COPY bench/fixture.py /opt/bench/fixture.py
RUN make CXXFLAGS="${BUILD_FLAGS}" test-color \
    && make CXXFLAGS="${BUILD_FLAGS}" test-flow \
    && make CXXFLAGS="${BUILD_FLAGS}" test-backend \
    && make CXXFLAGS="${BUILD_FLAGS}" \
    && mkdir -p /opt/native/viewer \
    && install -m 0755 native-stream /opt/native/native-stream \
    && install -m 0644 viewer/index.html viewer/viewer.js /opt/native/viewer/

COPY session.sh /opt/native/session.sh
RUN chmod 0755 /opt/native/session.sh

USER bench
WORKDIR /home/bench
ENV DISPLAY=:1 HOME=/home/bench USER=bench XDG_RUNTIME_DIR=/home/bench/runtime
EXPOSE 8080
ENTRYPOINT ["dbus-run-session", "--", "/opt/native/session.sh"]
