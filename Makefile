CXX ?= g++
CPPFLAGS += $(shell pkg-config --cflags x11 xext xdamage xfixes xtst libavcodec libavutil libswscale libwebsockets)
CXXFLAGS ?= -O2
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -pthread
LDLIBS += $(shell pkg-config --libs x11 xext xdamage xfixes xtst libavcodec libavutil libswscale libwebsockets) -pthread

.PHONY: all test-color
all: native-stream

native-stream: src/capture.cpp src/server.cpp src/color.cpp src/capture.hpp src/color.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/capture.cpp src/server.cpp src/color.cpp -o $@ $(LDLIBS)

build/color-test: tests/color-test.cpp src/color.cpp src/color.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) tests/color-test.cpp src/color.cpp -o $@

test-color: build/color-test
	./build/color-test
