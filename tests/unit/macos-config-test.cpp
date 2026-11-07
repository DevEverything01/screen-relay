#include "server/backend.hpp"
#include "server/config.hpp"
#include <membership.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cassert>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <vector>

namespace relay {
const Backend& defaultBackend() {
  static const Backend backend{"test", nullptr, nullptr, nullptr};
  return backend;
}
const Backend& backendFor(const std::string&) { return defaultBackend(); }
std::string backendNames() { return "test"; }
}

static bool acceptsToken(const std::filesystem::path& viewer, const std::filesystem::path& token) {
  std::vector<std::string> args{"relay-engine", "--viewer-dir", viewer.string(), "--token-file", token.string()};
  std::vector<char*> argv;
  for (auto& arg : args) argv.push_back(arg.data());
  relay::Config config;
  try { return relay::parseConfig(int(argv.size()), argv.data(), config); }
  catch (const std::runtime_error&) { return false; }
}

static void setAcl(const std::filesystem::path& file, std::initializer_list<acl_tag_t> tags) {
  uuid_t user;
  assert(mbr_uid_to_uuid(geteuid(), user) == 0);
  acl_t acl = acl_init(int(tags.size()));
  assert(acl);
  for (const auto tag : tags) {
    acl_entry_t entry;
    acl_permset_t perms;
    assert(acl_create_entry_np(&acl, &entry, ACL_LAST_ENTRY) == 0);
    assert(acl_set_tag_type(entry, tag) == 0);
    assert(acl_set_qualifier(entry, user) == 0);
    assert(acl_get_permset(entry, &perms) == 0);
    assert(acl_add_perm(perms, tag == ACL_EXTENDED_DENY ? ACL_WRITE_DATA : ACL_READ_DATA) == 0);
  }
  assert(acl_set_file(file.c_str(), ACL_TYPE_EXTENDED, acl) == 0);
  assert(acl_free(acl) == 0);
  acl = acl_get_file(file.c_str(), ACL_TYPE_EXTENDED);
  assert(acl);
  int index = ACL_FIRST_ENTRY;
  for (const auto expected : tags) {
    acl_entry_t entry;
    acl_permset_t perms;
    acl_tag_t tag;
    assert(acl_get_entry(acl, index, &entry) == 0 && acl_get_tag_type(entry, &tag) == 0 && tag == expected);
    assert(acl_get_permset(entry, &perms) == 0);
    assert(acl_get_perm_np(perms, tag == ACL_EXTENDED_DENY ? ACL_WRITE_DATA : ACL_READ_DATA) == 1);
    index = ACL_NEXT_ENTRY;
  }
  assert(acl_free(acl) == 0);
}

int main() {
  std::string name = (std::filesystem::temp_directory_path() / "relay-acl-test-XXXXXX").string();
  assert(mkdtemp(name.data()));
  const std::filesystem::path directory{name};
  const auto viewer = directory / "viewer";
  const auto token = directory / "token";
  std::filesystem::create_directory(viewer);
  std::ofstream(viewer / "index.html");
  std::ofstream(viewer / "viewer.js");
  { std::ofstream output(token); output << std::string(64, 'a'); }
  assert(chmod(token.c_str(), 0600) == 0);
  assert(acceptsToken(viewer, token));
  setAcl(token, {ACL_EXTENDED_DENY});
  assert(acceptsToken(viewer, token));
  setAcl(token, {ACL_EXTENDED_ALLOW});
  assert(!acceptsToken(viewer, token));
  setAcl(token, {ACL_EXTENDED_DENY, ACL_EXTENDED_ALLOW});
  assert(!acceptsToken(viewer, token));
  std::filesystem::remove_all(directory);
}
