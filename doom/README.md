# Live Doom in the native stream viewer

This image starts a new, live single-player Freedoom game on episode 1, map 1. Crispy Doom renders to the existing 1280×720 X display and the native stream server serves that desktop on port 8080. It does not play a demo or recorded video.

From `native-stream-lab/`, build after `native-stream-lab:standalone` exists locally:

```sh
docker build --platform linux/arm64 \
  --build-arg BASE_IMAGE=native-stream-lab:standalone \
  -t native-stream-lab:doom \
  -f doom/Dockerfile \
  doom
```

Start the container in the foreground:

```sh
docker run \
  --cpus 2 --memory 1536m --memory-swap 1536m --shm-size 512m \
  -p 127.0.0.1:18094:8080 \
  native-stream-lab:doom
```

Open <http://127.0.0.1:18094>. Focus the game canvas to send keyboard input. Default Doom keyboard controls work: arrow keys move and turn, Ctrl fires, Space uses doors, Alt strafes, Shift runs, and number keys select weapons. Mouse input is disabled because the viewer sends absolute pointer positions while this game expects relative mouse movement.

The config enables Crispy Doom's uncapped interpolated renderer with `crispy_fpslimit 60`; the X display is 1280×720. The 60 FPS setting is a ceiling, not a measured throughput claim. Verify that the live session sustains above 35 rendered FPS on the benchmark host before reporting it.

The image installs Debian Trixie's `crispy-doom` and `freedoom` packages. Freedoom supplies freely redistributable game assets; no proprietary Doom WAD is included. Crispy Doom's documented settings include the uncapped interpolated mode, `crispy_fpslimit`, and fullscreen desktop resolution. See [Debian's Crispy Doom ARM64 package](https://packages.debian.org/trixie/arm64/crispy-doom), [Crispy Doom's project documentation](https://github.com/fabiangreffrath/crispy-doom), [the Trixie config manual](https://manpages.debian.org/trixie/crispy-doom/crispy-doom.cfg.5.en.html), and [Freedoom's license overview](https://freedoom.github.io/about.html).

The launcher sets `SDL_FRAMEBUFFER_ACCELERATION=0` because SDL can otherwise create an accelerated window-surface presenter backed by CPU llvmpipe even when Crispy Doom requests software rendering. The same-image live-input diagnostic verified lower CPU and higher delivered FPS with this setting. See the [final report](../optimize/native-stream-report.md) and [SDL hint documentation](https://wiki.libsdl.org/SDL2/SDL_HINT_FRAMEBUFFER_ACCELERATION). This changes presentation, not the game resolution or assets.
