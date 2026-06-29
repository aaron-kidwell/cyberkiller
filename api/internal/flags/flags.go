// Package flags defines the on-disk flag paths and generates random flag values.
package flags

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// Standard paths where the target entrypoint writes the flag files.
const (
	UserPath = "/home/ckplayer/user.txt"
	RootPath = "/root/root.txt"
)

// GeneratePair returns a fresh user flag and root flag in the CK{...} format.
func GeneratePair() (user, root string, err error) {
	ub := make([]byte, 10)
	rb := make([]byte, 10)
	if _, err = rand.Read(ub); err != nil {
		return "", "", err
	}
	if _, err = rand.Read(rb); err != nil {
		return "", "", err
	}
	user = fmt.Sprintf("CK{user-%s}", hex.EncodeToString(ub))
	root = fmt.Sprintf("CK{root-%s}", hex.EncodeToString(rb))
	return user, root, nil
}
