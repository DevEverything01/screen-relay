CXX ?= g++
BACKENDS ?= x11
AVAILABLE_BACKENDS = x11
BACKEND_PKGS_x11 = x11 xext xdamage xfixes xtst
BACKEND_DIR_x11 = linux/x11
ifneq ($(filter-out $(AVAILABLE_BACKENDS),$(BACKENDS)),)
$(error Unknown BACKENDS '$(filter-out $(AVAILABLE_BACKENDS),$(BACKENDS))'; available: $(AVAILABLE_BACKENDS))
endif
ifeq ($(strip $(BACKENDS)),)
$(error BACKENDS must name at least one backend; available: $(AVAILABLE_BACKENDS))
endif
BACKEND_PKGS = $(sort $(foreach backend,$(BACKENDS),$(BACKEND_PKGS_$(backend))))
BACKEND_DIRS = $(sort $(foreach backend,$(BACKENDS),$(BACKEND_DIR_$(backend))))
BACKEND_CPPFLAGS = $(foreach backend,$(sort $(BACKENDS)),-DRELAY_BACKEND_$(backend))
CODEC_PKGS = x264
PKGS = $(sort $(BACKEND_PKGS) $(CODEC_PKGS) libwebsockets zlib)
CPPFLAGS += -Isrc/engine $(BACKEND_CPPFLAGS) $(shell pkg-config --cflags $(PKGS))
CXXFLAGS ?= -O2
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -pthread
LDLIBS += $(shell pkg-config --libs $(PKGS)) -pthread

CORE_SRCS = $(wildcard src/engine/core/*.cpp)
BACKEND_SRCS = $(foreach dir,$(BACKEND_DIRS),$(wildcard src/engine/backends/$(dir)/*.cpp))
ENGINE_SRCS = $(CORE_SRCS) $(wildcard src/engine/server/*.cpp) $(BACKEND_SRCS)
HEADERS = $(wildcard src/engine/*/*.hpp src/engine/backends/linux/*.hpp) $(foreach dir,$(BACKEND_DIRS),$(wildcard src/engine/backends/$(dir)/*.hpp))

PREFIX ?= /usr/local
.PHONY: all install test test-color test-flow test-input test-backend test-server clean FORCE
all: relay-engine

install: relay-engine
	@test -f dist/viewer/viewer.js || { echo 'Run npm run build first (dist/viewer is missing).' >&2; exit 1; }
	install -d "$(DESTDIR)$(PREFIX)/lib/relay/viewer" "$(DESTDIR)$(PREFIX)/bin"
	install -m 0755 relay-engine "$(DESTDIR)$(PREFIX)/lib/relay/relay-engine"
	install -m 0644 dist/viewer/index.html dist/viewer/viewer.js "$(DESTDIR)$(PREFIX)/lib/relay/viewer/"
	ln -sfn ../lib/relay/relay-engine "$(DESTDIR)$(PREFIX)/bin/relay-engine"

build/backends: FORCE
	mkdir -p build
	@printf '%s\n' '$(strip $(BACKENDS))' | cmp -s - $@ || printf '%s\n' '$(strip $(BACKENDS))' > $@

FORCE:

relay-engine: $(ENGINE_SRCS) $(HEADERS) build/backends
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(ENGINE_SRCS) -o $@ $(LDLIBS)

build/color-test: tests/unit/color-test.cpp src/engine/core/color.cpp src/engine/core/color.hpp
	mkdir -p build
	$(CXX) -Isrc/engine $(CXXFLAGS) tests/unit/color-test.cpp src/engine/core/color.cpp -o $@

test-color: build/color-test
	./build/color-test

build/flow-test: tests/unit/flow-test.cpp src/engine/core/flow.hpp
	mkdir -p build
	$(CXX) -Isrc/engine $(CXXFLAGS) tests/unit/flow-test.cpp -o $@

test-flow: build/flow-test
	./build/flow-test

build/input-test: tests/unit/input-test.cpp src/engine/core/input.cpp src/engine/core/input.hpp
	mkdir -p build
	$(CXX) -Isrc/engine $(CXXFLAGS) tests/unit/input-test.cpp src/engine/core/input.cpp -o $@

test-input: build/input-test
	./build/input-test

build/backend-source-test: tests/unit/backend-source-test.cpp $(CORE_SRCS) $(wildcard src/engine/core/*.hpp)
	mkdir -p build
	$(CXX) -Isrc/engine $(CXXFLAGS) tests/unit/backend-source-test.cpp $(CORE_SRCS) -o $@ $(shell pkg-config --cflags --libs $(CODEC_PKGS) libavcodec libavutil libswscale)

test-backend: build/backend-source-test
	./build/backend-source-test

SERVER_TEST_SRCS = src/engine/server/config.cpp src/engine/server/metrics.cpp src/engine/server/wire.cpp src/engine/server/backend.cpp src/engine/core/input.cpp $(BACKEND_SRCS)

build/test-viewer/viewer.js:
	mkdir -p build/test-viewer
	: > build/test-viewer/index.html
	: > build/test-viewer/viewer.js

build/server-test: tests/unit/server-test.cpp $(SERVER_TEST_SRCS) $(HEADERS) build/test-viewer/viewer.js build/backends
	mkdir -p build
	$(CXX) -Isrc/engine $(BACKEND_CPPFLAGS) $(shell pkg-config --cflags $(BACKEND_PKGS) libwebsockets) $(CXXFLAGS) tests/unit/server-test.cpp $(SERVER_TEST_SRCS) -o $@ $(shell pkg-config --libs $(BACKEND_PKGS) libwebsockets)

test-server: build/server-test
	./build/server-test

test: test-color test-flow test-input test-backend test-server

clean:
	rm -rf build relay-engine
