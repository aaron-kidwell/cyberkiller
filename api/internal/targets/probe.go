package targets

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"
)

// ProbeOpenPorts TCP-checks arena IP from the control plane (post-DNAT path).
func ProbeOpenPorts(arenaIP string) []map[string]any {
	if os.Getenv("LOCAL_DOCKER_ORCHESTRATION") != "true" || arenaIP == "" {
		return nil
	}
	checks := []struct {
		port int
		svc  string
	}{
		{22, "ssh"},
		{80, "http"},
	}
	var open []map[string]any
	for _, c := range checks {
		if probeTCP(arenaIP, strconv.Itoa(c.port), 3*time.Second) == nil {
			open = append(open, map[string]any{
				"port": c.port, "service": c.svc, "live": true,
			})
		}
	}
	return open
}

func probeTCP(host, port string, timeout time.Duration) error {
	script := fmt.Sprintf(`
if command -v timeout >/dev/null 2>&1; then
  timeout %d bash -c 'echo >/dev/tcp/%s/%s' 2>/dev/null
else
  bash -c 'echo >/dev/tcp/%s/%s' 2>/dev/null
fi
`, int(timeout.Seconds()), host, port, host, port)
	return exec.Command("bash", "-c", script).Run()
}
