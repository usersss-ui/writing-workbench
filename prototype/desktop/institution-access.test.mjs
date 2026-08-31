import test from "node:test"
import assert from "node:assert/strict"
import { validateInstitutionConfig } from "../../exporter/paper-library/institution-config.mjs"
import {
  detectProvider,
  normalizeDoi,
  normalizeExternalHttpsUrl,
  parsePaperInput,
  resolveInstitutionAccess,
} from "./institution-access.mjs"

const SENSITIVE_MARKER = ["sensitive", "marker"].join("-")
const POSIX_FILE = ["", "restricted", "paper.pdf"].join("/")
const WINDOWS_FILE = ["D:", "restricted", "paper.pdf"].join("\\")
const UNC_FILE = ["", "", "server", "share", "paper.pdf"].join("\\")

function credentialQueryUrl(keyParts) {
  const url = new URL("https://example.org/paper")
  url.searchParams.set(keyParts.join("_"), SENSITIVE_MARKER)
  return url.href
}

function obfuscatedCredentialQueryUrl(keyParts) {
  const url = new URL("https://example.org/paper")
  url.searchParams.set(keyParts.join(""), SENSITIVE_MARKER)
  return url.href
}

function credentialFragmentUrl(keyParts) {
  const url = new URL("https://example.org/paper")
  url.hash = `${keyParts.join("_")}=${SENSITIVE_MARKER}`
  return url.href
}

function userInfoUrl() {
  const url = new URL("https://example.org/paper")
  url.username = "reader"
  url.password = SENSITIVE_MARKER
  return url.href
}

function institutionFixture() {
  return validateInstitutionConfig({
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
        provider_id: "sciencedirect",
        display_name: "ScienceDirect",
        hosts: ["sciencedirect.com"],
        doi_prefixes: ["10.1016"],
        library_page: "https://lib.nuist.edu.cn/info/1015/1432.htm",
        carsi_entry_url: "https://auth.elsevier.com/ShibAuth/institutionLogin",
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
      {
        provider_id: "web-of-science",
        display_name: "Web of Science",
        hosts: ["webofscience.com"],
        doi_prefixes: [],
        library_page: "https://lib.nuist.edu.cn/info/1015/1436.htm",
        carsi_entry_url: "https://www.webofknowledge.com/?DestApp=UA",
        carsi_supported: true,
      },
    ],
  })
}

const institution = institutionFixture()

test("normalizes plain, prefixed, and doi.org DOI forms", () => {
  assert.equal(normalizeDoi("  DOI:10.1109/ABC.123  "), "10.1109/abc.123")
  assert.equal(normalizeDoi("https://doi.org/10.1007/S001"), "10.1007/s001")
})

test("rejects malformed DOI values instead of normalizing them", () => {
  for (const value of [
    "10.1109", "10.1109/a b", "10.1109/a?query=1", "10.1109/a#part",
    "10.1109/a\u0000b", `10.1109/${"a".repeat(248)}`, "10.1109/a!",
    "10.1234/../../admin", "doi:10.1234/../x", "10.1234//admin",
    "10.1234/x?next=1", "10.1234/x#part",
    ["https://doi.org/10.1234/a", "..", "b"].join("\\"),
    "https://doi.org/10.1234/a\n", "https://doi.org/10.1234/a\u2029",
  ]) assert.equal(normalizeDoi(value), null)
})

test("accepts only credential-free public HTTPS article URLs", () => {
  assert.equal(
    normalizeExternalHttpsUrl("https://ieeexplore.ieee.org/document/123"),
    "https://ieeexplore.ieee.org/document/123",
  )
  for (const value of [
    "http://example.org/paper", "file:///tmp/paper.pdf", "javascript:alert(1)",
    "data:text/html,x", "//example.org/paper", userInfoUrl(),
    "https://example.org:8443/paper", "https://example.org/../paper",
    "https://example.org/%2e%2e/paper", "https://example.org/..%2fpaper",
    "https://example.org/a/./paper", "https://localhost/paper", "https://service.local/paper",
    "https://127.0.0.1/paper", "https://2130706433/paper", "https://10.0.0.8/paper",
    "https://169.254.169.254/paper", "https://[::1]/paper",
    credentialQueryUrl(["access", "token"]), credentialQueryUrl(["api", "key"]),
    credentialFragmentUrl(["access", "token"]),
    obfuscatedCredentialQueryUrl(["oauth", "_", "token"]),
    obfuscatedCredentialQueryUrl(["token", "[", "]"]),
    obfuscatedCredentialQueryUrl(["api", "[", "key", "]"]),
    obfuscatedCredentialQueryUrl(["api", "key", "[", "]"]),
    obfuscatedCredentialQueryUrl(["oauth", "2_", "token"]),
    obfuscatedCredentialQueryUrl(["my", "_", "token"]),
    obfuscatedCredentialQueryUrl(["service", "_", "api", "_", "key"]),
    obfuscatedCredentialQueryUrl(["x", "-", "amz", "-", "signa", "ture"]),
    obfuscatedCredentialQueryUrl(["j", "wt"]),
    ["https://example.org", "..", "paper"].join("\\"),
    "https://exa\nmple.org/paper", "https://example.org/pa\tper",
    "https://\texample.org/paper", "https://example.org/pa\u2028per",
    "https://0/paper", "https://127.1/paper", "https://0x7f000001/paper",
    "https://0177.0.0.1/paper", "https://172.16.0.1/paper", "https://192.168.1.1/paper",
    "https://100.64.0.1/paper", "https://[::]/paper", "https://[::ffff:127.0.0.1]/paper",
    "https://[fc00::1]/paper", "https://[fe80::1]/paper", "https://localhost./paper",
    "https://sub.localhost/paper", "https://host.home.arpa/paper", "https://intranet/paper",
  ]) assert.equal(normalizeExternalHttpsUrl(value), null)
})

test("does not inspect query values as raw URL paths", () => {
  assert.equal(
    normalizeExternalHttpsUrl("https://example.org?next=/../paper"),
    "https://example.org/?next=/../paper",
  )
})

test("keeps ordinary public query metadata distinct from credential aliases", () => {
  const url = new URL("https://example.org/paper")
  url.searchParams.set(["conference", "session"].join("_"), "2026")
  url.searchParams.set(["citation", "style"].join("_"), "numeric")
  assert.equal(normalizeExternalHttpsUrl(url.href), url.href)
})

test("parses reliable inputs and refuses unsafe values as titles", () => {
  assert.deepEqual(parsePaperInput("10.1109/ABC.123"), {
    kind: "doi", doi: "10.1109/abc.123", sourceUrl: null, title: null,
  })
  assert.deepEqual(parsePaperInput("https://ieeexplore.ieee.org/document/123"), {
    kind: "url", doi: null, sourceUrl: "https://ieeexplore.ieee.org/document/123", title: null,
  })
  assert.deepEqual(parsePaperInput("A Reliable English Paper Title"), {
    kind: "title", doi: null, sourceUrl: null, title: "A Reliable English Paper Title",
  })
  for (const value of [
    "10.1109/no space", "https://bad.example/../paper", "//bad.example/paper",
    "ftp://bad.example/paper", "https://localhost/paper", POSIX_FILE,
    "../paper.pdf", "~/paper.pdf", WINDOWS_FILE, UNC_FILE,
    ["..", "paper.pdf"].join("\\"), [".", "paper.pdf"].join("\\"),
    ["~", "paper.pdf"].join("\\"), ["folder", "paper.pdf"].join("\\"),
    "\nSafe title", "Safe title\t",
    "bad\u0000title", "bad\ttitle", "bad\u007ftitle", "bad\u2028title", "bad\u2029title",
  ]) assert.throws(() => parsePaperInput(value), /请输入|格式|安全|DOI|HTTPS|题名|单行/u)
})

test("rejects obvious local paper filenames without rejecting ordinary slash titles", () => {
  for (const value of ["paper.pdf", "folder/paper.pdf", "notes.md"]) {
    assert.throws(() => parsePaperInput(value), /格式|安全|DOI|HTTPS/u)
  }
  assert.deepEqual(parsePaperInput("Primal/Dual Methods for Optimization"), {
    kind: "title",
    doi: null,
    sourceUrl: null,
    title: "Primal/Dual Methods for Optimization",
  })
})

test("does not downgrade malformed DOI resolver forms to article URLs or titles", () => {
  for (const value of [
    "https://doi.org/10.1109/a?query=1",
    "https://doi.org/not-a-doi",
    "https://dx.doi.org/10.1109/a#fragment",
    "doi.org/10.1109/not-a-doi!",
  ]) assert.throws(() => parsePaperInput(value), /DOI|格式|安全/u)
})

test("detects every configured provider by its controlled DOI prefix or host", () => {
  for (const [doi, providerId] of [
    ["10.1109/5.771073", "ieee"], ["10.1016/j.test.2026.1", "sciencedirect"],
    ["10.1007/s001", "springer"], ["10.1002/test", "wiley"],
    ["10.1111/test", "wiley"], ["10.1080/test", "taylor-francis"],
  ]) {
    assert.equal(detectProvider({ institution, explicitProviderId: "", input: parsePaperInput(doi) }).provider.provider_id, providerId)
  }
  for (const [url, providerId] of [
    ["https://ieeexplore.ieee.org/document/1", "ieee"],
    ["https://www.sciencedirect.com/science/article/pii/x", "sciencedirect"],
    ["https://link.springer.com/article/1", "springer"],
    ["https://onlinelibrary.wiley.com/doi/1", "wiley"],
    ["https://www.tandfonline.com/doi/1", "taylor-francis"],
    ["https://www.webofscience.com/wos/1", "web-of-science"],
  ]) {
    assert.equal(detectProvider({ institution, explicitProviderId: "", input: parsePaperInput(url) }).provider.provider_id, providerId)
  }
})

test("uses explicit then DOI prefix then host precedence and reports conflicts", () => {
  const urlInput = parsePaperInput("https://ieeexplore.ieee.org/document/1")
  assert.equal(detectProvider({ institution, explicitProviderId: "springer", input: urlInput }).basis, "explicit")
  assert.notEqual(detectProvider({ institution, explicitProviderId: "springer", input: urlInput }).conflicts.length, 0)
  assert.equal(
    detectProvider({ institution, explicitProviderId: "", input: { ...parsePaperInput("10.1109/x"), sourceUrl: urlInput.sourceUrl } }).basis,
    "doi_prefix",
  )
  assert.equal(detectProvider({ institution, explicitProviderId: "", input: urlInput }).basis, "host")
  assert.equal(
    detectProvider({ institution, explicitProviderId: "", input: parsePaperInput("https://ieeexplore.ieee.org.evil.example/paper") }).provider,
    null,
  )
})

test("returns CARSI only for verified entries and library lookup otherwise", () => {
  for (const [rawInput, providerId, status] of [
    ["10.1109/5.771073", "ieee", "carsi_available"],
    ["10.1016/j.test.2026.1", "sciencedirect", "carsi_available"],
    ["https://www.webofscience.com/wos/1", "web-of-science", "carsi_available"],
    ["10.1007/s001", "springer", "library_lookup_required"],
    ["10.1002/test", "wiley", "library_lookup_required"],
    ["10.1080/test", "taylor-francis", "library_lookup_required"],
  ]) {
    const result = resolveInstitutionAccess({ rawInput, explicitProviderId: "", institution })
    assert.equal(result.provider.provider_id, providerId)
    assert.equal(result.institutionAccess.status, status)
    if (status === "carsi_available") assert.notEqual(result.institutionAccess.authenticationUrl, null)
    else assert.equal(result.institutionAccess.authenticationUrl, null)
  }
  const unknown = resolveInstitutionAccess({ rawInput: "https://unknown.example/paper", explicitProviderId: "", institution })
  assert.equal(unknown.institutionAccess.status, "library_lookup_required")
  assert.equal(unknown.institutionAccess.authenticationUrl, null)
  assert.equal(unknown.institutionAccess.libraryLookupUrl, institution.fallback_page)
})

test("keeps DOI, title, open access, and school access states independent", () => {
  const doiResult = resolveInstitutionAccess({ rawInput: "10.1109/5.771073", explicitProviderId: "", institution })
  assert.equal(doiResult.institutionAccess.articleUrl, "https://doi.org/10.1109/5.771073")
  assert.deepEqual(doiResult.copyTarget, { kind: "doi", value: "10.1109/5.771073" })

  const titleResult = resolveInstitutionAccess({ rawInput: "A Reliable English Paper Title", explicitProviderId: "", institution })
  assert.equal(titleResult.institutionAccess.articleUrl, null)
  assert.deepEqual(titleResult.copyTarget, { kind: "title", value: "A Reliable English Paper Title" })

  for (const url of [
    "https://arxiv.org/abs/1234.5678",
    "https://openreview.net/forum?id=1",
    "https://pmc.ncbi.nlm.nih.gov/articles/1/",
  ]) {
    const result = resolveInstitutionAccess({ rawInput: url, explicitProviderId: "ieee", institution })
    assert.deepEqual(result.openAccess, { status: "open_access", url })
    assert.equal(result.institutionAccess.status, "carsi_available")
  }
})

test("does not mutate the validated institution profile and gives bounded explanations", () => {
  const before = structuredClone(institution)
  const result = resolveInstitutionAccess({
    rawInput: "https://ieeexplore.ieee.org/document/1",
    explicitProviderId: "springer",
    institution,
  })
  assert.deepEqual(institution, before)
  assert.equal(result.warnings.some((warning) => warning.includes("学校入口不代表目标论文已订购")), true)
  assert.equal(result.warnings.length > 1, true)
  assert.equal(JSON.stringify(result).includes(["pass", "word"].join("")), false)
  assert.equal(JSON.stringify(result).includes(["coo", "kie"].join("")), false)
})
