import os, base64, json, subprocess, urllib.request, urllib.parse, sys, time

GH = r"C:\Users\Lenovo\anaconda3\envs\ghcli\Library\bin\gh.exe"
OWNER = "Justin325010"
REPO = "ch8-workbench"
BASE = r"C:\Users\Lenovo\Documents\ChatGPT\测试\ch8_workbench_static"
SKIP = {"dom_check.html", "edge.log", "preview.png"}

def gh_token():
    p = subprocess.run([GH, "auth", "token"], capture_output=True, text=True, check=True)
    return p.stdout.strip()

def api(method, path, body=None, token=None):
    url = "https://api.github.com" + path
    data = None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "codex-deploy",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        print("HTTP_ERROR", method, path, e.code, detail, file=sys.stderr)
        raise

def collect_files():
    out = []
    for root, dirs, files in os.walk(BASE):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, BASE).replace(os.sep, "/")
            if rel in SKIP:
                continue
            out.append((rel, full))
    out.sort()
    return out

def main():
    token = gh_token()
    repo = api("GET", f"/repos/{OWNER}/{REPO}", token=token)
    branch = repo["default_branch"]
    ref = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{branch}", token=token)
    commit_sha = ref["object"]["sha"]
    commit = api("GET", f"/repos/{OWNER}/{REPO}/git/commits/{commit_sha}", token=token)
    base_tree = commit["tree"]["sha"]

    files = collect_files()
    entries = []
    for idx, (rel, full) in enumerate(files, 1):
        with open(full, "rb") as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode("ascii")
        blob = api("POST", f"/repos/{OWNER}/{REPO}/git/blobs", {"content": b64, "encoding": "base64"}, token)
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"[{idx}/{len(files)}] blob {rel} {len(raw)} bytes -> {blob['sha']}", flush=True)

    tree = api("POST", f"/repos/{OWNER}/{REPO}/git/trees", {"base_tree": base_tree, "tree": entries}, token)
    new_commit = api("POST", f"/repos/{OWNER}/{REPO}/git/commits",
        {"message": "Deploy ch8 workbench static demo", "tree": tree["sha"], "parents": [commit_sha]}, token)
    api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{branch}",
        {"sha": new_commit["sha"], "force": False}, token)
    print("DEPLOYED_COMMIT=" + new_commit["sha"])
    print("BRANCH=" + branch)

if __name__ == "__main__":
    main()
