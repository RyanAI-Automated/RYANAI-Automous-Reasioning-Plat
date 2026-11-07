export function languageFromPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const languages: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    js: 'JavaScript',
    jsx: 'JavaScript React',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    h: 'C/C++',
    sql: 'SQL',
    sh: 'Bash',
    ps1: 'PowerShell',
    json: 'JSON',
    md: 'Markdown',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return languages[ext] ?? 'Text';
}

export function canApproveJob(jobCreatorId: string, currentUserId?: string, isAdmin = false): boolean {
  return Boolean(isAdmin && currentUserId && jobCreatorId !== currentUserId);
}

export function diffFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^\+\+\+ b\/(.+)$/);
    if (match && match[1] !== '/dev/null') files.add(match[1]);
  }
  return [...files];
}

