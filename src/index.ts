const VERSION = '0.0.1';

const USAGE = `askwhy ${VERSION}

Usage:
  askwhy init              detect agents, install hooks, notes ref, git alias
  git why <path>[:<line>]  intent for the hunk covering a line
  askwhy receipt [sha]     proof for a commit or the pending turn
  askwhy price [--since]   cost per change, per session, per agent
  askwhy pending           records waiting for a commit
  askwhy export            Agent Trace JSON for a range
  askwhy doctor            hooks installed? notes ref ok? agents detected?
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
      process.stderr.write(`askwhy: '${command}' is not implemented yet\n\n${USAGE}`);
      return 2;
  }
}
