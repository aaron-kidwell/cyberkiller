package targets

import (
	"fmt"
	"net"
	"os/exec"
	"strings"
	"time"

	"github.com/cyberkiller/api/internal/flags"
)

// GateParams describes a machine about to enter the arena.
type GateParams struct {
	Container string
	ArenaIP   string
	BridgeIP  string
}

// GateResult is the outcome of all pre-arena checks.
type GateResult struct {
	OK         bool
	FailedStep string
	Detail     string
}

// RunHealthGate executes checks before a machine appears on radar.
func RunHealthGate(p GateParams) GateResult {
	if p.Container == "" || p.ArenaIP == "" {
		return GateResult{FailedStep: "config", Detail: "missing container or arena IP"}
	}
	if p.BridgeIP == "" {
		var err error
		p.BridgeIP, err = ContainerIP(p.Container)
		if err != nil || p.BridgeIP == "" {
			return GateResult{FailedStep: "bridge_ip", Detail: "could not resolve container IP on ck-arena"}
		}
	}

	if err := waitServicesReady(p); err != nil {
		return GateResult{FailedStep: "services_ready", Detail: err.Error()}
	}

	checks := []struct {
		step string
		fn   func() error
	}{
		{"container_running", gateCheckRunning(p.Container)},
		{"user_flag", gateCheckUserFlag(p)},
		{"root_flag", gateCheckRootFlag(p)},
	}
	for _, c := range checks {
		if err := c.fn(); err != nil {
			return GateResult{OK: false, FailedStep: c.step, Detail: err.Error()}
		}
	}
	return GateResult{OK: true}
}

// waitServicesReady waits for the container to be running and at least one of
// its standard service ports (SSH or HTTP) to accept connections.
func waitServicesReady(p GateParams) error {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if gateCheckRunning(p.Container)() != nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if gateCheckPort(p.BridgeIP, "22")() == nil || gateCheckPort(p.BridgeIP, "80")() == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("no service port reachable on %s within 30s", p.BridgeIP)
}

func gateCheckRunning(name string) func() error {
	return func() error {
		out, err := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", name).Output()
		if err != nil {
			return fmt.Errorf("inspect: %w", err)
		}
		if strings.TrimSpace(string(out)) != "true" {
			return fmt.Errorf("container not running")
		}
		return nil
	}
}

func gateCheckPort(ip, port string) func() error {
	return func() error {
		return gateTCPProbe(ip, port, 3*time.Second)
	}
}

func gateCheckUserFlag(p GateParams) func() error {
	return gateCheckFlagFile(p.Container, flags.UserPath, "user")
}

func gateCheckRootFlag(p GateParams) func() error {
	return gateCheckFlagFile(p.Container, flags.RootPath, "root")
}

func gateCheckFlagFile(container, path, label string) func() error {
	return func() error {
		out, err := exec.Command("docker", "exec", container, "test", "-f", path).CombinedOutput()
		if err != nil {
			return fmt.Errorf("%s flag path missing %s: %s", label, path, strings.TrimSpace(string(out)))
		}
		_, err = exec.Command("docker", "exec", container, "cat", path).Output()
		if err != nil {
			return fmt.Errorf("read %s flag: %w", label, err)
		}
		return nil
	}
}

func gateTCPProbe(host, port string, timeout time.Duration) error {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), timeout)
	if err != nil {
		return fmt.Errorf("TCP %s:%s not reachable from control plane", host, port)
	}
	conn.Close()
	return nil
}
