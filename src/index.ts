const VERSION = '0.0.1';

const USAGE = `gitwhy ${VERSION}

Usage:
  gitwhy init              detect agents, install hooks, notes ref, git alias
  git why <path>[:<line>]  intent for the hunk covering a line
  gitwhy receipt [sha]     proof for a commit or the pending turn
  gitwhy price [--since]   cost per change, per session, per agent
  gitwhy pending           records waiting for a commit
  gitwhy export            Agent Trace JSON for a range
  gitwhy doctor            hooks installed? notes ref ok? agents detected?
`;

export async function run(argv: string[]): Promise<number> {
  const [command] = argv;
  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    case '-v':
    case '--version':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    default:
      process.stderr.write(`gitwhy: '${command}' is not implemented yet\n\n${USAGE}`);
      return 2;
  }
}
