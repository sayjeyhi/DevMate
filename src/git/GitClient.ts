interface BunSubprocess {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}

declare const Bun: {
  spawn(args: string[], opts: { stdout: 'pipe'; stderr: 'pipe'; cwd?: string }): BunSubprocess
}

export class GitClient {
  constructor(readonly repoPath: string) {}

  private async exec(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', cwd: this.repoPath })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  }

  async currentBranch(): Promise<string> {
    const { stdout, exitCode } = await this.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    if (exitCode !== 0) throw new Error('Failed to get current branch')
    return stdout
  }

  async isClean(): Promise<boolean> {
    const { stdout } = await this.exec(['git', 'status', '--porcelain'])
    return stdout.length === 0
  }

  async checkoutNewBranchFromMain(branchName: string, remote = 'origin', base = 'main'): Promise<void> {
    const fetch = await this.exec(['git', 'fetch', remote, base])
    if (fetch.exitCode !== 0) throw new Error(`git fetch failed: ${fetch.stderr}`)

    const checkout = await this.exec(['git', 'checkout', '-b', branchName, `${remote}/${base}`])
    if (checkout.exitCode !== 0) throw new Error(`git checkout failed: ${checkout.stderr}`)
  }

  async isGitRepo(): Promise<boolean> {
    const { exitCode } = await this.exec(['git', 'rev-parse', '--git-dir'])
    return exitCode === 0
  }

  async stash(message?: string): Promise<void> {
    const args = ['git', 'stash', 'push', '--include-untracked']
    if (message) args.push('-m', message)
    const { exitCode, stderr } = await this.exec(args)
    if (exitCode !== 0) throw new Error(stderr || 'git stash failed')
  }

  async stashPop(): Promise<void> {
    const { exitCode, stderr } = await this.exec(['git', 'stash', 'pop'])
    if (exitCode !== 0) throw new Error(stderr || 'git stash pop failed')
  }

  async getDiffStat(): Promise<string> {
    const { stdout } = await this.exec(['git', 'diff', 'HEAD', '--stat'])
    return stdout.trim()
  }

  async stageAll(): Promise<void> {
    const { exitCode, stderr } = await this.exec(['git', 'add', '.'])
    if (exitCode !== 0) throw new Error(stderr || 'git add failed')
  }

  async commit(message: string): Promise<void> {
    const { exitCode, stderr } = await this.exec(['git', 'commit', '-m', message])
    if (exitCode !== 0) throw new Error(stderr || 'git commit failed')
  }

  async pull(remote = 'origin'): Promise<string> {
    const branch = await this.currentBranch()
    const { exitCode, stdout, stderr } = await this.exec(['git', 'pull', remote, branch])
    if (exitCode !== 0) throw new Error(stderr || 'git pull failed')
    return stdout
  }

  async push(remote = 'origin'): Promise<void> {
    const branch = await this.currentBranch()
    const { exitCode, stderr } = await this.exec(['git', 'push', '--set-upstream', remote, branch])
    if (exitCode !== 0) throw new Error(stderr || 'git push failed')
  }

  async createPr(): Promise<string> {
    const create = await this.exec(['gh', 'pr', 'create', '--fill'])
    if (create.exitCode === 0) {
      const url = create.stdout.trim().split('\n').at(-1)?.trim() ?? ''
      if (url.startsWith('https://')) return url
    }
    // PR may already exist — fetch its URL
    const view = await this.exec(['gh', 'pr', 'view', '--json', 'url', '--jq', '.url'])
    if (view.exitCode === 0 && view.stdout.trim().startsWith('https://')) {
      return view.stdout.trim()
    }
    throw new Error(create.stderr || 'gh pr create failed')
  }
}
