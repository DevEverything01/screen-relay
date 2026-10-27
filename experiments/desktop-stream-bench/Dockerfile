FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xfce4 xfce4-terminal dbus-x11 at-spi2-core xvfb xauth x11-utils x11-xserver-utils xdotool python3 python3-tk python3-pil fonts-dejavu-core procps iproute2 pulseaudio scrot chromium sudo
RUN curl -fL https://github.com/selkies-project/selkies/releases/download/2.1.0/selkies-2.1.0-debiantrixie-arm64.deb -o /tmp/selkies.deb && curl -fL https://github.com/kasmtech/KasmVNC/releases/download/v1.5.2/kasmvncserver_debian_trixie_1.5.2_arm64.deb -o /tmp/kasm.deb && apt-get install -y /tmp/selkies.deb /tmp/kasm.deb
RUN apt-get install -y --no-install-recommends libavformat-dev libavcodec-dev libavutil-dev libswscale-dev libswresample-dev
RUN useradd --create-home --shell /bin/bash bench && mkdir -p /opt/bench /home/bench/.vnc /home/bench/runtime /tmp/.X11-unix && chown -R bench:bench /home/bench && chmod 700 /home/bench/runtime && chmod 1777 /tmp/.X11-unix
COPY fixture.py session.sh /opt/bench/
RUN chmod +x /opt/bench/session.sh
ENV DISPLAY=:1 HOME=/home/bench USER=bench XDG_RUNTIME_DIR=/home/bench/runtime
USER bench
WORKDIR /home/bench
EXPOSE 8080
ENTRYPOINT ["dbus-run-session", "--", "/opt/bench/session.sh"]
