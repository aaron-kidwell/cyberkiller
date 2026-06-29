// Package images handles community-submitted target machines: a player proposes
// a Docker image, an admin reviews it, and on approval it becomes a usable
// target in the catalog. Two steps: Submit (player) and Approve (admin).
package images

import (
	"context"

	"github.com/cyberkiller/api/internal/db"
	"github.com/google/uuid"
)

// SubmitRequest is the JSON body a player POSTs to suggest an image.
type SubmitRequest struct {
	PlayerID    string `json:"player_id"`
	DockerImage string `json:"docker_image"`
	MachineName string `json:"machine_name"`
	Tier        string `json:"tier"`
	Description string `json:"description"`
}

// Submit stores a pending submission.
func Submit(ctx context.Context, req SubmitRequest) error {
	// NULLIF($1,'')::uuid stores NULL when player_id is empty rather than failing
	// to cast "" to a uuid.
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO image_submissions (player_id, docker_image, machine_name, tier, description)
		VALUES (NULLIF($1,'')::uuid, $2, $3, $4, $5)
	`, req.PlayerID, req.DockerImage, req.MachineName, req.Tier, req.Description)
	return err
}

// Approve promotes a submission into the live target catalog and marks the
// submission approved. It's two related writes, so it reads the submission
// first, then inserts the catalog row, then updates the submission status.
func Approve(ctx context.Context, submissionID uuid.UUID, note string) error {
	var dockerImage, machineName, tier string
	var playerID uuid.UUID
	err := db.Pool.QueryRow(ctx, `
		SELECT docker_image, machine_name, tier, player_id FROM image_submissions WHERE id=$1
	`, submissionID).Scan(&dockerImage, &machineName, &tier, &playerID)
	if err != nil {
		return err
	}

	imgID := "community-" + submissionID.String()[:8]
	_, err = db.Pool.Exec(ctx, `
		INSERT INTO target_images (id, name, docker_image, tier, enabled, description)
		VALUES ($1, $2, $3, $4, true, $5)
		ON CONFLICT (id) DO UPDATE SET enabled=true
	`, imgID, machineName, dockerImage, tier, note)
	if err != nil {
		return err
	}

	// Finally mark the original submission as approved with the admin's note.
	_, err = db.Pool.Exec(ctx, `
		UPDATE image_submissions SET status='approved', admin_note=$2, reviewed_at=NOW() WHERE id=$1
	`, submissionID, note)
	return err
}
