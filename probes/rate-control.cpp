// Real-codec regression probe: change VBV on one live CRF encoder.
#include <array>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
}

namespace {
constexpr int width = 1280, height = 720, fps = 60;
constexpr int phaseFrames = 240, settleFrames = 60;
constexpr std::array<int64_t, 3> rates{8000000, 2000000, 8000000};
void require(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}
void check(int result, const char* operation) {
  if (result < 0) {
    char error[AV_ERROR_MAX_STRING_SIZE];
    av_strerror(result, error, sizeof(error));
    throw std::runtime_error(std::string(operation) + ": " + error);
  }
}
struct Probe {
  AVCodecContext* encoder = nullptr;
  AVCodecContext* decoder = nullptr;
  AVFrame* input = av_frame_alloc();
  AVFrame* output = av_frame_alloc();
  AVPacket* packet = av_packet_alloc();
  std::array<int64_t, 3> measuredBytes{};
  int decoded = 0, packets = 0;
  ~Probe() {
    av_packet_free(&packet);
    av_frame_free(&input);
    av_frame_free(&output);
    avcodec_free_context(&encoder);
    avcodec_free_context(&decoder);
  }
  void receiveDecoded() {
    int result;
    while ((result = avcodec_receive_frame(decoder, output)) >= 0) {
      require(output->width == width && output->height == height,
              "decoded dimensions changed");
      require(output->decode_error_flags == 0, "decoder reported damaged frame");
      ++decoded;
      av_frame_unref(output);
    }
    require(result == AVERROR(EAGAIN) || result == AVERROR_EOF,
            "receiving decoded frame failed");
  }
  void receivePackets() {
    int result;
    while ((result = avcodec_receive_packet(encoder, packet)) >= 0) {
      require(packet->pts != AV_NOPTS_VALUE, "encoder omitted packet timestamp");
      const int frame = int(av_rescale_q(packet->pts, encoder->time_base,
                                         AVRational{1, fps}));
      require(frame >= 0 && frame < phaseFrames * 3, "invalid packet timestamp");
      if (frame % phaseFrames >= settleFrames)
        measuredBytes[frame / phaseFrames] += packet->size;
      ++packets;
      check(avcodec_send_packet(decoder, packet), "sending packet to decoder");
      receiveDecoded();
      av_packet_unref(packet);
    }
    require(result == AVERROR(EAGAIN) || result == AVERROR_EOF,
            "receiving encoded packet failed");
  }
  void run() {
    require(input && output && packet, "allocating frames/packet failed");
    const AVCodec* codec = avcodec_find_encoder_by_name("libx264");
    require(codec, "libx264 unavailable");
    encoder = avcodec_alloc_context3(codec);
    const AVCodec* h264 = avcodec_find_decoder(AV_CODEC_ID_H264);
    require(h264, "H.264 decoder unavailable");
    decoder = avcodec_alloc_context3(h264);
    require(encoder && decoder, "allocating codec contexts failed");
    encoder->width = width; encoder->height = height;
    encoder->pix_fmt = AV_PIX_FMT_YUV420P;
    encoder->time_base = AVRational{1, 1000000};
    encoder->framerate = AVRational{fps, 1};
    encoder->rc_max_rate = rates[0]; encoder->rc_buffer_size = int(rates[0] / 4);
    encoder->max_b_frames = 0; encoder->gop_size = 600; encoder->thread_count = 2;
    check(av_opt_set(encoder->priv_data, "preset", "ultrafast", 0), "preset");
    check(av_opt_set(encoder->priv_data, "tune", "zerolatency", 0), "tune");
    check(av_opt_set(encoder->priv_data, "crf", "10", 0), "CRF");
    check(av_opt_set(encoder->priv_data, "x264-params",
      "annexb=1:repeat-headers=1:scenecut=0:rc-lookahead=0:sync-lookahead=0", 0),
      "x264 parameters");
    check(avcodec_open2(encoder, codec, nullptr), "opening encoder");
    decoder->err_recognition = AV_EF_EXPLODE;
    decoder->thread_count = 1;
    check(avcodec_open2(decoder, h264, nullptr), "opening decoder");
    input->format = encoder->pix_fmt; input->width = width; input->height = height;
    check(av_frame_get_buffer(input, 32), "allocating input pixels");
    for (int frame = 0; frame < phaseFrames * 3; ++frame) {
      const int phase = frame / phaseFrames;
      if (frame % phaseFrames == 0) {
        encoder->rc_max_rate = rates[phase];
        encoder->rc_buffer_size = int(rates[phase] / 4);
      }
      check(av_frame_make_writable(input), "making input writable");
      // Replay identical high-entropy motion in each phase to control workload drift.
      uint32_t random = 0x9e3779b9u ^ uint32_t(frame % phaseFrames + 1);
      for (int plane = 0; plane < 3; ++plane) {
        const int w = width >> (plane != 0), h = height >> (plane != 0);
        for (int y = 0; y < h; ++y) {
          uint8_t* row = input->data[plane] + y * input->linesize[plane];
          for (int x = 0; x < w; ++x) {
            random ^= random << 13; random ^= random >> 17; random ^= random << 5;
            row[x] = uint8_t(16 + random % (plane == 0 ? 220 : 225));
          }
        }
      }
      input->pts = av_rescale_q(frame, AVRational{1, fps}, encoder->time_base);
      check(avcodec_send_frame(encoder, input), "sending input frame");
      receivePackets();
    }
    check(avcodec_send_frame(encoder, nullptr), "flushing encoder");
    receivePackets();
    check(avcodec_send_packet(decoder, nullptr), "flushing decoder");
    receiveDecoded();
    require(decoded == phaseFrames * 3, "decoded frame count mismatch");
    const double seconds = double(phaseFrames - settleFrames) / fps;
    std::array<double, 3> bps{};
    for (int phase = 0; phase < 3; ++phase) bps[phase] = measuredBytes[phase] * 8 / seconds;
    // Broad behavioral bounds catch ignored reconfiguration without asserting exact CBR.
    const bool effective = bps[1] < bps[0] * 0.55 && bps[2] > bps[1] * 1.8 &&
                          bps[0] > rates[0] * 0.5 && bps[2] > rates[2] * 0.5 &&
                          bps[1] < rates[1] * 1.5;
    std::printf("{\"codec\":\"libx264\",\"avcodec_version\":%u,\"crf\":10,"
      "\"fps\":60,\"width\":1280,\"height\":720,\"frames_per_phase\":240,"
      "\"settle_frames\":60,\"clock\":\"frame_timestamps\",\"phases\":[",
      avcodec_version());
    for (int phase = 0; phase < 3; ++phase)
      std::printf("%s{\"max_rate_bps\":%lld,\"buffer_bits\":%lld,\"measured_bytes\":%lld,"
        "\"measured_seconds\":%.3f,\"measured_bps\":%.3f}", phase ? "," : "",
        (long long)rates[phase], (long long)(rates[phase] / 4),
        (long long)measuredBytes[phase], seconds, bps[phase]);
    std::printf("],\"packets\":%d,\"decoded_frames\":%d,\"passed\":%s}\n",
                packets, decoded, effective ? "true" : "false");
    require(effective, "live CRF/VBV downshift or recovery ineffective");
  }
};
}
int main() {
  try { Probe probe; probe.run(); return 0; }
  catch (const std::exception& error) {
    std::fprintf(stderr, "rate-control probe: %s\n", error.what()); return 1;
  }
}
