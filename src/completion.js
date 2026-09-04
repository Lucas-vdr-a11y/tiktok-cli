'use strict';

/**
 * Shell completion scripts for captron (bash, zsh, fish).
 * Generated at runtime from the live commander program, so new commands
 * and flags appear automatically — nothing hardcoded to go stale.
 *
 * Input: cmds = [{ name, desc, flags: [{ long, short, desc, takesValue }] }],
 *        globals = same flag shape (program-level options like --jobs).
 */

// -- escaping ---------------------------------------------------------------

function escDq(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

function escSq(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function oneLine(s) {
  return String(s || '').split('\n')[0].replace(/\s+/g, ' ').trim();
}

function varName(cmd) {
  return '_captron_flags_' + String(cmd).replace(/[^a-zA-Z0-9_]/g, '_');
}

// -- bash -------------------------------------------------------------------

function buildBashCompletion(cmds, globals) {
  const g = globals.map((f) => f.long).filter(Boolean).join(' ');
  const lines = [
    '# captron completion (bash) — generated, do not edit by hand',
    '# usage: eval "$(captron completion bash)"',
    '_captron_cmds="' + cmds.map((c) => c.name).join(' ') + '"',
    '_captron_global="' + escDq(g) + '"',
  ];
  for (const c of cmds) {
    lines.push(varName(c.name) + '="' + escDq(c.flags.map((f) => f.long).filter(Boolean).join(' ')) + '"');
  }
  lines.push(
    '_captron() {',
    '  local cur="${COMP_WORDS[COMP_CWORD]}" sub var all',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    '    COMPREPLY=($(compgen -W "$_captron_cmds" -- "$cur"))',
    '    return 0',
    '  fi',
    '  sub="${COMP_WORDS[1]}"',
    '  var="_captron_flags_${sub//[^a-zA-Z0-9_]/_}"',
    '  all="${!var} $_captron_global"',
    '  COMPREPLY=($(compgen -W "$all" -- "$cur"))',
    '}',
    'complete -F _captron captron',
    ''
  );
  return lines.join('\n');
}

// -- zsh --------------------------------------------------------------------

function zshFlagSpec(f) {
  // _arguments spec: '--flag[description]: :_guard' — strip [] from descs.
  const desc = oneLine(f.desc).replace(/[\[\]]/g, '').replace(/'/g, "''");
  return "'" + (f.long || '') + '[' + desc + ']' + (f.takesValue ? ':value:_files' : '') + "'";
}

function buildZshCompletion(cmds, globals) {
  const gspec = globals.map(zshFlagSpec).join(' ');
  const lines = [
    '#compdef captron',
    '# captron completion (zsh) — generated, do not edit by hand',
    '# usage: eval "$(captron completion zsh)"',
    '_captron() {',
    '  local -a cmds',
    '  cmds=(',
  ];
  const q = (s) => String(s).replace(/'/g, "''");
  for (const c of cmds) {
    lines.push("    '" + q(c.name) + ':' + q(oneLine(c.desc)) + "'");
  }
  lines.push(
    '  )',
    '  _arguments -C "1:command:->cmd" "*:: :->args"',
    '  case "$state" in',
    '    cmd) _describe "captron command" cmds ;;',
    '    args)',
    '      case "${words[2]}" in',
  );
  for (const c of cmds) {
    const specs = c.flags.map(zshFlagSpec).concat([gspec]).filter(Boolean).join(' ');
    lines.push('        ' + c.name + ') _arguments ' + (specs || "'*: :_files'") + ' ;;');
  }
  lines.push(
    '        *) _arguments ' + (gspec || "'*: :_files'") + ' ;;',
    '      esac ;;',
    '  esac',
    '}',
    'compdef _captron captron',
    ''
  );
  return lines.join('\n');
}

// -- fish -------------------------------------------------------------------

function buildFishCompletion(cmds, globals) {
  const lines = [
    '# captron completion (fish) — generated, do not edit by hand',
    '# usage: captron completion fish > ~/.config/fish/completions/captron.fish',
  ];
  for (const c of cmds) {
    lines.push("complete -c captron -f -n '__fish_use_subcommand' -a '" + escSq(c.name) + "' -d '" + escSq(oneLine(c.desc)) + "'");
  }
  const emit = (sub, f) => {
    let line = "complete -c captron -f -n '__fish_seen_subcommand_from " + escSq(sub) + "'";
    if (f.short) line += " -s '" + escSq(f.short.replace(/^-+/, '')) + "'";
    if (f.long) line += " -l '" + escSq(f.long.replace(/^-+/, '')) + "'";
    if (f.desc) line += " -d '" + escSq(oneLine(f.desc)) + "'";
    if (f.takesValue) line += ' -r';
    return line;
  };
  for (const c of cmds) {
    for (const f of c.flags) {
      if (!f.long && !f.short) continue;
      lines.push(emit(c.name, f));
    }
    for (const f of globals) {
      if (!f.long && !f.short) continue;
      lines.push(emit(c.name, f));
    }
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { buildBashCompletion, buildZshCompletion, buildFishCompletion };
