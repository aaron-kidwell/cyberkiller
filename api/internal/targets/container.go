package targets

import (
	"os/exec"
	"strings"
)

// ResolveContainerName returns the Docker container name for inspect/exec.
// instance_id may be a name (ck-*, koth-*) or a legacy short container ID.
func ResolveContainerName(instanceID string) string {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return ""
	}
	if strings.HasPrefix(instanceID, "ck-") || strings.HasPrefix(instanceID, "koth-") {
		if running(instanceID) {
			return instanceID
		}
		return ""
	}
	out, err := exec.Command("docker", "ps", "-a", "--no-trunc", "--filter", "id="+instanceID,
		"--format", "{{.Names}}").Output()
	if err != nil {
		return ""
	}
	name := strings.TrimSpace(string(out))
	if name != "" && running(name) {
		return name
	}
	return ""
}

func running(name string) bool {
	err := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", name).Run()
	return err == nil
}
