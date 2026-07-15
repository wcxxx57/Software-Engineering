session := "zhiying-ui"

serve:
  tmux has-session -t {{session}} 2>/dev/null || tmux new -d -s {{session}} 'python3 -m http.server 3001 --directory src'
  xdg-open http://localhost:3001

stop:
  -tmux kill-session -t {{session}}

log:
  tmux attach -t {{session}}
