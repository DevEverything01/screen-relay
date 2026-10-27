CXX ?= g++
BACKEND ?= x11
BACKEND_PKGS_x11 = x11 xext xdamage xfixes xtst
ifeq ($(BACKEND_PKGS_$(BACKEND)),)
$(error Unknown BACKEND '$(BACKEND)'; available: x11)
endif
CODEC_PKGS = libavcodec libavutil libswscale
PKGS = $(BACKEND_PKGS_$(BACKEND)) $(CODEC_PKGS) libwebsockets
CPPFLAGS += -Isrc $(shell pkg-config --cflags $(PKGS))
CXXFLAGS ?= -O2
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -pthread
LDLIBS += $(shell pkg-config --libs $(PKGS)) -pthread

CORE_SRCS = $(wildcard src/core/*.cpp)
ENGINE_SRCS = $(CORE_SRCS) $(wildcard src/server/*.cpp src/backends/$(BACKEND)/*.cpp)
HEADERS = $(wildcard src/*/*.hpp src/backends/$(BACKEND)/*.hpp)

PREFIX ?= /usr/local
.PHONY: all install test test-color test-flow test-backend clean
all: native-stream

install: native-stream
	install -d "$(DESTDIR)$(PREFIX)/lib/native-stream/viewer" "$(DESTDIR)$(PREFIX)/bin"
	install -m 0755 native-stream "$(DESTDIR)$(PREFIX)/lib/native-stream/native-stream-engine"
	install -m 0644 viewer/index.html viewer/viewer.js "$(DESTDIR)$(PREFIX)/lib/native-stream/viewer/"
	ln -sfn ../lib/native-stream/native-stream-engine "$(DESTDIR)$(PREFIX)/bin/native-stream-engine"
	install -m 0755 scripts/native-stream-desktop "$(DESTDIR)$(PREFIX)/bin/native-stream-desktop"

native-stream: $(ENGINE_SRCS) $(HEADERS)
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
	$(CXX) -Isrc $(CXXFLAGS) tests/unit/backend-source-test.cpp $(CORE_SRCS) -o $@ $(shell pkg-config --cflags --libs $(CODEC_PKGS))

test-backend: build/backend-source-test
	./build/backend-source-test

test: test-color test-flow test-backend

clean:
	rm -rf build native-stream
