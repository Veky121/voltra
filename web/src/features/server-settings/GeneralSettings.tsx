import {ReinstallServerButton} from './ReinstallServerButton';
import {usePendingSetting} from '../shared/PendingSettings';
import '../backups/backups.css';
import '../servers/powerProgress.css';
import {useEffect, useState, type ReactNode} from 'react';
import {SettingsRow, SettingsSection} from '../../ui/Settings';
import {Link} from 'react-router-dom';
import {api, useAPI, Input, Textarea} from '../../lib';
import {can, json, Notice, useAction, useServer, value} from '../shared/common';
import type {Account, Resource} from '../../types/api';
export function Settings({details, showReinstall = true}: {details?: ReactNode; showReinstall?: boolean} = {}) {
  const {base, server, permissions, reload} = useServer();
  const fs25 = Array.isArray(server.egg_features) && server.egg_features.includes('voltra_fs25');
  const account = useAPI<Resource<Account>>('/api/client/account');
  const a = useAction();
  const [name, setName] = useState(server.name || ''),
    [description, setDescription] = useState(server.description || '');
  const user: Partial<Account> = value(account.data) || {};
  const sftp = server.sftp_details || {};
  const [saving, setSaving] = useState(false),
    [baseline, setBaseline] = useState({name: server.name || '', description: server.description || ''});
  // The page may open on a saved copy of the server and receive a newer one a
  // moment later, or someone else may rename it meanwhile. Fields the user has
  // not touched follow the newest values; edited fields keep the edit.
  const latestName = server.name || '',
    latestDescription = server.description || '';
  useEffect(() => {
    if (latestName === baseline.name && latestDescription === baseline.description) return;
    if (name === baseline.name) setName(latestName);
    if (description === baseline.description) setDescription(latestDescription);
    setBaseline({name: latestName, description: latestDescription});
  }, [latestName, latestDescription]);
  async function saveDetails() {
    setSaving(true);
    a.setError('');
    try {
      // Only what changed is sent; the name is always required by the panel.
      await api(
        `${base}/settings/rename`,
        json('POST', description === baseline.description ? {name} : {name, description})
      );
      setBaseline({name, description});
    } catch (error) {
      a.setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }
  usePendingSetting(`details:${base}`, !details && (name !== baseline.name || description !== baseline.description), {
    blocked: saving || !name.trim() || !can(permissions, 'settings.rename'),
    save: saveDetails,
    afterSave: reload,
    discard: () => {
      setName(baseline.name);
      setDescription(baseline.description);
      a.setError('');
    },
  });
  return (
    <section className="operations-page settings-page server-general-settings">
      <Notice action={a} />
      <div className="server-general-grid">
        {details ?? (
          <SettingsSection title="Panel details">
            <form
              onSubmit={e => {
                e.preventDefault();
                void saveDetails().catch(() => {});
              }}
            >
              <SettingsRow
                label="Panel name"
                description="Shown only in Voltra."
                control={
                  <Input
                    aria-label="Panel name"
                    required
                    disabled={!can(permissions, 'settings.rename')}
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                }
              />
              <SettingsRow
                label="Description"
                control={
                  <Textarea
                    aria-label="Server description"
                    disabled={!can(permissions, 'settings.rename')}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                }
              />
            </form>
          </SettingsSection>
        )}
        <SettingsSection title="SFTP">
          <SettingsRow
            label="Address"
            control={
              <Input
                aria-label="SFTP address"
                readOnly
                value={`sftp://${sftp.ip || server.node}:${sftp.port || 2022}`}
              />
            }
          />
          <SettingsRow
            label="Username"
            control={
              <Input
                aria-label="SFTP username"
                readOnly
                value={`${user.username || ''}.${server.__deprecated_uuid_short || server.uuid?.slice(0, 8) || server.identifier || ''}`}
              />
            }
          />
          <div className="settings-actions settings-actions--split">
            <span className="settings-note">
              <Link to="/account/sftp">Password</Link> · <Link to="/account/ssh">SSH keys</Link>
            </span>
            {can(permissions, 'file.sftp') && (
              <a
                className="button secondary"
                href={`sftp://${encodeURIComponent(
                  `${user.username || ''}.${server.__deprecated_uuid_short || server.uuid?.slice(0, 8) || server.identifier || ''}`
                )}@${sftp.ip || server.node}:${sftp.port || 2022}`}
              >
                Open client
              </a>
            )}
          </div>
        </SettingsSection>
        <SettingsSection title="Server information">
          <SettingsRow label="Node" control={<span className="settings-value">{server.node}</span>} />
          <SettingsRow label="UUID" control={<Input aria-label="Server UUID" readOnly value={server.uuid || ''} />} />
        </SettingsSection>
        {showReinstall && can(permissions, 'settings.reinstall') && (
          <SettingsSection title="Reinstall">
            <SettingsRow
              label="Reinstall server"
              description={
                fs25
                  ? 'Updates FS25 first, then DLCs. Keeps saves, mods, settings and licences.'
                  : 'Stops the server and may overwrite files. Back up first.'
              }
              control={<ReinstallServerButton server={server} permissions={permissions} onDone={reload} />}
            />
          </SettingsSection>
        )}
      </div>
    </section>
  );
}
