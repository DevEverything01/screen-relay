#include "wait.hpp"
#include <cerrno>
#include <ctime>
#include <stdexcept>

#ifdef _WIN32
#include <windows.h>
#else
#include <poll.h>
#include <sys/eventfd.h>
#include <unistd.h>
#endif

namespace relay {
#ifdef _WIN32
Wake::Wake() : handle_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
Wake::~Wake() { if (handle_) CloseHandle(handle_); }
bool Wake::valid() const { return handle_ != nullptr; }
void Wake::signal() { if (handle_) SetEvent(handle_); }
bool Wake::consume() {
  if (!handle_ || WaitForSingleObject(handle_, 0) != WAIT_OBJECT_0) return false;
  ResetEvent(handle_);
  return true;
}
WaitReady wait(WaitHandle source, Wake& wake, int64_t timeout_ns) {
  thread_local HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                                                      TIMER_ALL_ACCESS);
  HANDLE handles[3] = {source, wake.handle(), timer};
  DWORD count = 2, limit = INFINITE;
  if (timeout_ns >= 0) {
    if (timer) {
      LARGE_INTEGER due;
      due.QuadPart = -(timeout_ns / 100);
      if (!SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE)) throw std::runtime_error("capture timer failed");
      count = 3;
    } else {
      limit = DWORD((timeout_ns + 999999) / 1000000);
    }
  }
  const DWORD result = WaitForMultipleObjects(count, handles, FALSE, limit);
  if (result == WAIT_FAILED) throw std::runtime_error("capture wait failed");
  WaitReady ready;
  ready.source = WaitForSingleObject(source, 0) == WAIT_OBJECT_0;
  ready.wake = result == WAIT_OBJECT_0 + 1;
  return ready;
}
#else
Wake::Wake() : handle_(eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK)) {}
Wake::~Wake() { if (handle_ >= 0) close(handle_); }
bool Wake::valid() const { return handle_ >= 0; }
void Wake::signal() {
  const uint64_t one = 1;
  if (handle_ >= 0) { const auto result = write(handle_, &one, sizeof(one)); (void)result; }
}
bool Wake::consume() {
  uint64_t value;
  return handle_ >= 0 && read(handle_, &value, sizeof(value)) == sizeof(value);
}
WaitReady wait(WaitHandle source, Wake& wake, int64_t timeout_ns) {
  timespec timeout{};
  const timespec* timeout_ptr = nullptr;
  if (timeout_ns >= 0) {
    timeout = {static_cast<time_t>(timeout_ns / 1000000000), static_cast<long>(timeout_ns % 1000000000)};
    timeout_ptr = &timeout;
  }
  pollfd descriptors[2] = {{source, POLLIN, 0}, {wake.handle(), POLLIN, 0}};
  if (ppoll(descriptors, 2, timeout_ptr, nullptr) < 0) {
    if (errno == EINTR) return {};
    throw std::runtime_error("capture ppoll failed");
  }
  if (descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)) throw std::runtime_error("capture source connection closed");
  return {bool(descriptors[0].revents & POLLIN), bool(descriptors[1].revents & POLLIN)};
}
#endif
}
