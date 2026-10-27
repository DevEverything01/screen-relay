CXX ?= g++
CPPFLAGS += $(shell pkg-config --cflags x11 xext xdamage xfixes xtst libavcodec libavutil libswscale libwebsockets)
CXXFLAGS ?= -O2
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -pthread
LDLIBS += $(shell pkg-config --libs x11 xext xdamage xfixes xtst libavcodec libavutil libswscale libwebsockets) -pthread

PREFIX ?= /usr/local
.PHONY: all install test-color test-flow test-backend
all: native-stream

install: native-stream
	install -d "$(DESTDIR)$(PREFIX)/lib/native-stream/viewer" "$(DESTDIR)$(PREFIX)/bin"
	install -m 0755 native-stream "$(DESTDIR)$(PREFIX)/lib/native-stream/native-stream-engine"
	install -m 0644 viewer/index.html viewer/viewer.js "$(DESTDIR)$(PREFIX)/lib/native-stream/viewer/"
	ln -sfn ../lib/native-stream/native-stream-engine "$(DESTDIR)$(PREFIX)/bin/native-stream-engine"
	install -m 0755 scripts/native-stream-desktop "$(DESTDIR)$(PREFIX)/bin/native-stream-desktop"

native-stream: src/capture.cpp src/server.cpp src/color.cpp src/x11-capture.cpp src/x11-input.cpp src/capture.hpp src/color.hpp src/flow.hpp src/capture-source.hpp src/input.hpp src/snapshot.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/capture.cpp src/server.cpp src/color.cpp src/x11-capture.cpp src/x11-input.cpp -o $@ $(LDLIBS)

build/color-test: tests/color-test.cpp src/color.cpp src/color.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) tests/color-test.cpp src/color.cpp -o $@

test-color: build/color-test
	./build/color-test

build/flow-test: tests/flow-test.cpp src/flow.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) tests/flow-test.cpp -o $@

test-flow: build/flow-test
	./build/flow-test

build/backend-source-test: tests/backend-source-test.cpp src/capture.cpp src/color.cpp src/capture.hpp src/capture-source.hpp src/color.hpp src/flow.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) tests/backend-source-test.cpp src/capture.cpp src/color.cpp -o $@ $(shell pkg-config --cflags --libs libavcodec libavutil libswscale)

test-backend: build/backend-source-test
	./build/backend-source-test
