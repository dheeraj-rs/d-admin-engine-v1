# Custom zshrc for D-Admin AI Website Builder terminal
# Shows clean ~/projects prompt and locks users inside the project directory

autoload -U colors && colors

# Clean prompt: shows "~/projects > " in cyan — hides real server path
PROMPT="%F{#6ee7b7}~/projects%f %F{white}>%f "
RPROMPT=""
RPS1=""

# Make sure PATH is set correctly
export PATH="$PATH"

# Disable Oh-My-Zsh or Prezto if they were loaded
unset ZSH
unset PREZTODIR

# Basic aliases
alias ls='ls --color=auto 2>/dev/null || ls -G'
alias ll='ls -la'
alias clear='clear'

# ── Security: restrict navigation to stay inside the project root ──────────
# __PROJECT_ROOT__ is replaced at runtime by the actual project directory path,
# but we never expose that real path to the user (they always see ~/projects).
PROJECT_ROOT="${PWD}"           # set once when the shell starts (already cwd'd to project)

function cd() {
  if [[ $# -eq 0 ]]; then
    # bare `cd` → go to project root instead of real $HOME
    builtin cd "${PROJECT_ROOT}"
    return
  fi

  # Resolve what the target would be
  local target
  target="$(builtin cd "$@" 2>/dev/null && pwd)"
  if [[ $? -ne 0 ]]; then
    # Let builtin report the real error (no such file, etc.)
    builtin cd "$@"
    return $?
  fi

  # Block escaping above the project root
  if [[ "${target}" != "${PROJECT_ROOT}"* ]]; then
    echo "cd: permission denied: cannot navigate outside ~/projects"
    return 1
  fi

  builtin cd "$@"
}

# Override pwd to always show ~/projects/... instead of the real path
function pwd() {
  local real_pwd
  real_pwd="$(builtin pwd)"
  echo "${real_pwd/#${PROJECT_ROOT}/~\/projects}"
}
