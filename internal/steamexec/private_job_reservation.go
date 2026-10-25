package steamexec

import "errors"

func (e *Executor) reserveMaintenance(server string) (func(), error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.active[server] {
		return nil, errors.New("Steam maintenance already active for this server")
	}
	select {
	case e.slots <- struct{}{}:
	default:
		return nil, errors.New("node Steam maintenance capacity reached; retry later")
	}
	e.active[server] = true
	return func() { e.mu.Lock(); delete(e.active, server); e.mu.Unlock(); <-e.slots }, nil
}
