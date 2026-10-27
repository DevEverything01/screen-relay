ARG BASE_IMAGE=native-stream-lab:standalone
FROM ${BASE_IMAGE}

USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends crispy-doom freedoom

WORKDIR /opt/doom
COPY launch.sh README.md ./
RUN chmod 0755 /opt/doom/launch.sh

USER bench
ENV DISPLAY=:1 HOME=/home/bench USER=bench XDG_RUNTIME_DIR=/home/bench/runtime
EXPOSE 8080
ENTRYPOINT ["/opt/doom/launch.sh"]
