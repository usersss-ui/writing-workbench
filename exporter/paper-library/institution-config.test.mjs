import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadInstitutionConfig,
  validateInstitutionConfig,
} from "./institution-config.mjs"

const SENSITIVE_MARKER = ["sensitive", "marker"].join("-")
const POSIX_DIRECTORY = ["", "restricted", "papers"].join("/")
const WINDOWS_DIRECTORY = ["D:", "restricted", "papers"].join("\\")
const UNC_DIRECTORY = ["", "", "server", "share", "papers"].join("\\")

function credentialKeyCases() {
  return [
    ["user", "name"].join(""), "account", ["pass", "word"].join(""),
    ["coo", "kie"].join(""), "session", ["to", "ken"].join(""),
    ["api", "key"].join("_"), ["private", "key"].join("_"),
    ["client", "secret"].join("_"), ["sec", "ret"].join(""),
    ["creden", "tials"].join(""), ["access", "token"].join("_"),
    ["refresh", "token"].join("_"), ["id", "token"].join("_"),
    ["auth", "token"].join("_"), ["bearer", "token"].join("_"),
    ["secret", "key"].join("_"), ["session", "id"].join("_"),
    ["pass", "phrase"].join(""), ["authori", "zation"].join(""),
    ["x-api", "key"].join("-"),
  ]
}

function credentialQueryUrl(keyParts) {
  const url = new URL("https://example.com/page")
  url.searchParams.set(keyParts.join("_"), SENSITIVE_MARKER)
  return url.href
}

function userInfoUrl() {
  const url = new URL("https://example.com/")
  url.username = "reader"
  url.password = SENSITIVE_MARKER
  return url.href
}

function validNuistFixture() {
  return {
    version: 1,
    institution_id: "nuist",
    display_name: "南京信息工程大学",
    access_mode: "carsi",
    library_home: "https://lib.nuist.edu.cn/",
    fallback_page: "https://lib.nuist.edu.cn/zy1/wwsjk.htm",
    providers: [
      {
        provider_id: "ieee",
        display_name: "IEEE Xplore",
        hosts: ["ieeexplore.ieee.org"],
        doi_prefixes: ["10.1109"],
        library_page: "https://lib.nuist.edu.cn/info/1015/1430.htm",
        carsi_entry_url: "https://ieeexplore.ieee.org/servlet/wayf.jsp",
        carsi_supported: true,
      },
      {
        provider_id: "web-of-science",
        display_name: "Web of Science",
        hosts: ["webofscience.com"],
        doi_prefixes: [],
        library_page: "https://lib.nuist.edu.cn/info/1015/1436.htm",
        carsi_entry_url: null,
        carsi_supported: false,
      },
      {
        provider_id: "sciencedirect",
        display_name: "ScienceDirect",
        hosts: ["sciencedirect.com"],
        doi_prefixes: ["10.1016"],
        library_page: "https://lib.nuist.edu.cn/info/1015/1432.htm",
        carsi_entry_url: null,
        carsi_supported: true,
      },
      {
        provider_id: "springer",
        display_name: "Springer Link",
        hosts: ["link.springer.com"],
        doi_prefixes: ["10.1007"],
        library_page: "https://lib.nuist.edu.cn/zy1/wwsjk/1.htm",
        carsi_entry_url: null,
        carsi_supported: true,
      },
      {
        provider_id: "wiley",
        display_name: "Wiley Online Library",
        hosts: ["onlinelibrary.wiley.com"],
        doi_prefixes: ["10.1002", "10.1111"],
        library_page: "https://lib.nuist.edu.cn/info/1341/4533.htm",
        carsi_entry_url: null,
        carsi_supported: true,
      },
      {
        provider_id: "taylor-francis",
        display_name: "Taylor & Francis Online",
        hosts: ["tandfonline.com"],
        doi_prefixes: ["10.1080"],
        library_page: "https://lib.nuist.edu.cn/info/1341/4533.htm",
        carsi_entry_url: null,
        carsi_supported: true,
      },
    ],
  }
}

function assertConfigRejected(mutator, pattern = /配置|无效|重复/u) {
  const fixture = validNuistFixture()
  mutator(fixture)
  assert.throws(() => validateInstitutionConfig(fixture), pattern)
}

test("validates and deeply freezes one public CARSI institution profile", () => {
  const fixture = validNuistFixture()
  const profile = validateInstitutionConfig(fixture)
  assert.equal(profile.institution_id, "nuist")
  assert.equal(profile.access_mode, "carsi")
  assert.equal(profile.providers.length, 6)
  assert.equal(Object.isFrozen(profile), true)
  assert.equal(Object.isFrozen(profile.providers), true)
  assert.equal(Object.isFrozen(profile.providers[0]), true)
  assert.equal(Object.isFrozen(profile.providers[0].hosts), true)
  assert.notEqual(profile, fixture)
  assert.notEqual(profile.providers, fixture.providers)
  assert.notEqual(profile.providers[0], fixture.providers[0])
})

test("rejects credential-like fields at any depth", () => {
  for (const key of credentialKeyCases()) {
    const fixture = validNuistFixture()
    fixture.providers[0][key] = "forbidden"
    assert.throws(() => validateInstitutionConfig(fixture), /凭据字段/u)
  }
  const nested = validNuistFixture()
  nested.providers[0].metadata = { nested: [{ [["client", "secret"].join("_")]: "forbidden" }] }
  assert.throws(() => validateInstitutionConfig(nested), /凭据字段/u)
  const normalized = validNuistFixture()
  normalized.providers[0][["private", "key"].join("-")] = "forbidden"
  assert.throws(() => validateInstitutionConfig(normalized), /凭据字段/u)
})

test("redacts configuration-derived keys and duplicate values from errors", () => {
  const cases = [
    {
      sentinel: ["pass", "word"].join(""),
      mutate: (fixture) => { fixture.providers[0][["pass", "word"].join("")] = "forbidden" },
    },
    { sentinel: "SENTINEL_UNKNOWN_CONFIG_CONTENT", mutate: (fixture) => { fixture.SENTINEL_UNKNOWN_CONFIG_CONTENT = true } },
    { sentinel: "SENTINEL_PROVIDER_FIELD", mutate: (fixture) => { fixture.providers[0].SENTINEL_PROVIDER_FIELD = true } },
    {
      sentinel: "sentinel-provider-id",
      mutate: (fixture) => {
        fixture.providers[1].provider_id = "sentinel-provider-id"
        fixture.providers[2].provider_id = "sentinel-provider-id"
      },
    },
    {
      sentinel: "sentinel-config.example",
      mutate: (fixture) => {
        fixture.providers[1].hosts = ["sentinel-config.example"]
        fixture.providers[2].hosts = ["sentinel-config.example"]
      },
    },
    { sentinel: "10.1234567", mutate: (fixture) => { fixture.providers[1].doi_prefixes = ["10.1234567", "10.1234567"] } },
  ]
  for (const { sentinel, mutate } of cases) {
    const fixture = validNuistFixture()
    mutate(fixture)
    assert.throws(() => validateInstitutionConfig(fixture), (error) => {
      assert.equal(error instanceof Error, true)
      assert.equal(error.message.includes(sentinel), false)
      return true
    })
  }
})

test("rejects unknown top-level and provider fields", () => {
  assertConfigRejected((fixture) => { fixture.unknown = true }, /未知字段/u)
  assertConfigRejected((fixture) => { fixture.providers[0].unknown = true }, /未知字段/u)
})

test("enforces version and public CARSI access mode", () => {
  assertConfigRejected((fixture) => { fixture.version = 2 }, /version/u)
  assertConfigRejected((fixture) => { fixture.access_mode = "proxy" }, /access_mode/u)
})

test("rejects malformed, local, private-host, or credential-bearing URLs", () => {
  const fields = ["library_home", "fallback_page", "providers.0.library_page", "providers.0.carsi_entry_url"]
  for (const field of fields) {
    for (const value of [
      "http://example.com/", "file:///tmp/papers", "javascript:alert(1)",
      "data:text/plain,x", "//example.com/path", userInfoUrl(),
      "https://example.com/#fragment", "https://example.com:8443/", POSIX_DIRECTORY,
      WINDOWS_DIRECTORY, UNC_DIRECTORY, "https://example.com/a/../b",
      "https://localhost/page", "https://service.local/page", "https://127.0.0.1/page",
      "https://2130706433/page", "https://10.0.0.8/page", "https://169.254.169.254/page",
      "https://[::1]/page", "https://intranet/page", credentialQueryUrl(["access", "token"]),
      credentialQueryUrl(["api", "key"]),
    ]) {
      assertConfigRejected((fixture) => {
        if (field.startsWith("providers.")) fixture.providers[0][field.split(".").at(-1)] = value
        else fixture[field] = value
      }, /URL|路径|HTTPS|公网/u)
    }
  }
})

test("allows only null or a public HTTPS CARSI entry URL", () => {
  const fixture = validNuistFixture()
  fixture.providers[0].carsi_entry_url = null
  assert.doesNotThrow(() => validateInstitutionConfig(fixture))
  assertConfigRejected((value) => { value.providers[0].carsi_entry_url = 42 }, /carsi_entry_url/u)
})

test("rejects local paths in URL fields even when they resemble a file URL", () => {
  for (const value of [
    ["", "temporary", "library"].join("/"),
    ["D:", "library"].join("/"),
    ["", "", "nas", "share"].join("\\"),
    ["..", "restricted", "papers"].join("/"),
  ]) {
    assertConfigRejected((fixture) => { fixture.library_home = value }, /URL|路径|HTTPS/u)
  }
})

test("canonicalizes hosts and DOI prefixes before checking uniqueness", () => {
  const fixture = validNuistFixture()
  fixture.providers[0].hosts = ["IEEEXPLORE.IEEE.ORG."]
  fixture.providers[0].doi_prefixes = ["10.1109"]
  const profile = validateInstitutionConfig(fixture)
  assert.equal(profile.providers[0].hosts[0], "ieeexplore.ieee.org")
  assert.equal(profile.providers[0].doi_prefixes[0], "10.1109")

  assertConfigRejected((value) => { value.providers[1].provider_id = "ieee" }, /provider_id.*重复|重复/u)
  assertConfigRejected((value) => { value.providers[1].hosts = ["ieeexplore.ieee.org"] }, /host.*重复|重复/u)
  assertConfigRejected((value) => { value.providers[1].doi_prefixes = ["10.1109"] }, /DOI|重复/u)
  assertConfigRejected((value) => {
    value.providers[0].hosts = ["example.com"]
    value.providers[1].hosts = ["sub.example.com"]
  }, /host|主机|重叠|重复/u)
})

test("rejects malformed or private hosts", () => {
  for (const host of [
    "", "https://example.com", "example.com/path", "example.com:443",
    "*.example.com", "example.com..", "-example.com", "localhost",
    "127.0.0.1", "2130706433", "10.0.0.8", "169.254.169.254", "service.local",
  ]) {
    assertConfigRejected((fixture) => { fixture.providers[0].hosts = [host] }, /host|主机|公网/u)
  }
})

test("rejects malformed DOI prefixes", () => {
  for (const prefix of ["10.123", "10.1234567890", "11.1234", "10.abcd", "doi:10.1109"]) {
    assertConfigRejected((fixture) => { fixture.providers[0].doi_prefixes = [prefix] }, /DOI|doi_prefix/u)
  }
})

test("requires a valid library page for CARSI-supported providers", () => {
  assertConfigRejected((fixture) => { fixture.providers[0].library_page = null }, /library_page/u)
  assertConfigRejected((fixture) => { fixture.providers[0].library_page = "http://lib.nuist.edu.cn/page" }, /library_page|HTTPS|URL/u)
})

test("rejects inactive providers that still advertise a CARSI entry", () => {
  assertConfigRejected((fixture) => {
    fixture.providers[0].carsi_supported = false
    fixture.providers[0].carsi_entry_url = "https://example.org/entry"
  }, /carsi_entry_url|carsi_supported/u)
})

test("bounds public strings, arrays, URLs, and serialized configuration size", () => {
  assertConfigRejected((fixture) => { fixture.display_name = "x".repeat(201) }, /display_name|长度/u)
  assertConfigRejected((fixture) => { fixture.providers[0].display_name = "x".repeat(201) }, /display_name|长度/u)
  assertConfigRejected((fixture) => { fixture.providers = Array.from({ length: 51 }, () => fixture.providers[0]) }, /providers|数量|重复/u)
  assertConfigRejected((fixture) => { fixture.providers[0].hosts = Array.from({ length: 21 }, (_, index) => `h${index}.example.org`) }, /hosts|数量/u)
  assertConfigRejected((fixture) => { fixture.providers[0].doi_prefixes = Array.from({ length: 21 }, (_, index) => `10.${String(1000 + index)}`) }, /doi_prefixes|数量/u)
  assertConfigRejected((fixture) => { fixture.library_home = `https://example.org/${"x".repeat(2_100)}` }, /URL|长度|配置/u)
  assertConfigRejected((fixture) => { fixture.display_name = "bad\u0000name" }, /display_name|控制/u)

  const slashName = validNuistFixture()
  slashName.display_name = "南京信息/工程大学"
  assert.doesNotThrow(() => validateInstitutionConfig(slashName))
})

test("rejects malformed object and array field types", () => {
  for (const mutator of [
    (fixture) => { fixture.providers = {} },
    (fixture) => { fixture.providers[0] = [] },
    (fixture) => { fixture.providers[0].hosts = "example.com" },
    (fixture) => { fixture.providers[0].doi_prefixes = {} },
    (fixture) => { fixture.providers[0].carsi_supported = "true" },
  ]) assertConfigRejected(mutator, /对象|数组|类型|布尔/u)
})

test("loads UTF-8 JSON and returns the same deeply frozen shape", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "institution-config-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, "nuist.json")
  const fixture = validNuistFixture()
  await writeFile(configPath, JSON.stringify(fixture))
  const profile = await loadInstitutionConfig(configPath)
  assert.deepEqual(profile, validateInstitutionConfig(fixture))
  assert.equal(profile.institution_id, "nuist")
  assert.equal(Object.isFrozen(profile), true)
  assert.equal(Object.isFrozen(profile.providers[0].hosts), true)
})

test("loads the checked-in NUIST descriptor as public descriptive data", async () => {
  const profile = await loadInstitutionConfig(new URL("../config/institutions/nuist.json", import.meta.url))
  assert.equal(profile.institution_id, "nuist")
  assert.equal(profile.providers.length, 6)
  const serialized = JSON.stringify(profile)
  assert.equal(serialized.length < 100_000, true)
  assert.equal(serialized.includes("file:"), false)
  assert.equal(serialized.includes("localhost"), false)
  for (const provider of profile.providers) {
    assert.equal(provider.hosts.length > 0, true)
    for (const value of [provider.library_page, provider.carsi_entry_url].filter(Boolean)) {
      const url = new URL(value)
      assert.equal(url.protocol, "https:")
      assert.equal(url.username, "")
      assert.equal(url.password, "")
    }
  }
})

test("rejects missing, non-object, array, invalid JSON, invalid UTF-8, and oversized files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "institution-config-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(() => loadInstitutionConfig(join(root, "missing.json")), /配置/u)

  for (const [name, contents] of [
    ["array.json", "[]"],
    ["scalar.json", "null"],
    ["invalid.json", "{not-json"],
    ["oversized.json", `{"padding":"${"x".repeat(100_001)}"}`],
  ]) {
    const path = join(root, name)
    await writeFile(path, contents)
    await assert.rejects(() => loadInstitutionConfig(path), /配置|JSON|大小/u)
  }

  const invalidUtf8 = join(root, "invalid-utf8.json")
  await writeFile(invalidUtf8, Buffer.from([0xff, 0xfe, 0xfd]))
  await assert.rejects(() => loadInstitutionConfig(invalidUtf8), /UTF-8|编码|配置/u)
})
