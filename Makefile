CXX ?= g++
BACKEND ?= x11
BACKEND_PKGS_x11 = x11 xext xdamage xfixes xtst
ifeq ($(BACKEND_PKGS_$(BACKEND)),)
$(error Unknown BACKEND '$(BACKEND)'; available: x11)
endif
CODEC_PKGS = x264
PKGS = $(BACKEND_PKGS_$(BACKEND)) $(CODEC_PKGS) libwebsockets zlib
CPPFLAGS += -Isrc $(shell pkg-config --cflags $(PKGS))
CXXFLAGS ?= -O2
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -pthread
LDLIBS += $(shell pkg-config --libs $(PKGS)) -pthread

CORE_SRCS = $(wildcard src/core/*.cpp)
ENGINE_SRCS = $(CORE_SRCS) $(wildcard src/server/*.cpp src/backends/$(BACKEND)/*.cpp)
HEADERS = $(wildcard src/*/*.hpp src/backends/$(BACKEND)/*.hpp)

PREFIX ?= /usr/local
.PHONY: all install test test-color test-flow test-backend test-server clean
all: relay-engine

install: relay-engine
	install -d "$(DESTDIR)$(PREFIX)/lib/relay/viewer" "$(DESTDIR)$(PREFIX)/lib/relay/relaycli" "$(DESTDIR)$(PREFIX)/bin"
	install -m 0755 relay-engine "$(DESTDIR)$(PREFIX)/lib/relay/relay-engine"
	install -m 0644 viewer/index.html viewer/viewer.js "$(DESTDIR)$(PREFIX)/lib/relay/viewer/"
	ln -sfn ../lib/relay/relay-engine "$(DESTDIR)$(PREFIX)/bin/relay-engine"
	install -m 0755 scripts/relay "$(DESTDIR)$(PREFIX)/lib/relay/relay"
	install -m 0644 scripts/relaycli/*.py "$(DESTDIR)$(PREFIX)/lib/relay/relaycli/"
	ln -sfn ../lib/relay/relay "$(DESTDIR)$(PREFIX)/bin/relay"

relay-engine: $(ENGINE_SRCS) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(ENGINE_SRCS) -o $@ $(LDLIBS)

build/color-test: tests/unit/color-test.cpp src/core/color.cpp src/core/color.hpp
	mkdir -p build
	$(CXX) -Isrc $(CXXFLAGS) tests/unit/color-test.cpp src/core/color.cpp -o $@

test-color: build/color-test
	./build/color-test

build/flow-test: tests/unit/flow-test.cpp src/core/flow.hpp
	mkdir -p build
	$(CXX) -Isrc $(CXXFLAGS) tests/unit/flow-test.cpp -o $@

test-flow: build/flow-test
	./build/flow-test

build/backend-source-test: tests/unit/backend-source-test.cpp $(CORE_SRCS) $(wildcard src/core/*.hpp)
	mkdir -p build
	$(CXX) -Isrc $(CXXFLAGS) tests/unit/backend-source-test.cpp $(CORE_SRCS) -o $@ $(shell pkg-config --cflags --libs $(CODEC_PKGS) libavcodec libavutil libswscale)

test-backend: build/backend-source-test
	./build/backend-source-test

SERVER_TEST_SRCS = src/server/config.cpp src/server/metrics.cpp src/server/wire.cpp

build/server-test: tests/unit/server-test.cpp $(SERVER_TEST_SRCS) $(wildcard src/server/*.hpp) $(wildcard src/core/*.hpp)
	mkdir -p build
	$(CXX) -Isrc $(shell pkg-config --cflags libwebsockets) $(CXXFLAGS) tests/unit/server-test.cpp $(SERVER_TEST_SRCS) -o $@ $(shell pkg-config --libs libwebsockets)

test-server: build/server-test
	./build/server-test

test: test-color test-flow test-backend test-server

clean:
	rm -rf build relay-engine
