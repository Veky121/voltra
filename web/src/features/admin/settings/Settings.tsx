import '../../../ui/sectionTabs.css';
import {useDiscardSettings} from '../../shared/PendingSettings';
import {Disclosure, DisclosureTrigger} from '../../../ui/Disclosure';
import {useState, type ComponentProps} from 'react';
import {Loading} from '../../../lib';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '../../../components/ui/tabs';
import '../infrastructure/infrastructure-ui.css';
import {Editor, ErrorMessage, Heading, f, useAPI} from '../shared';
import type {Resource, UnknownRecord} from '../../../types/api';
function SettingsEditor({title, ...props}: ComponentProps<typeof Editor>) {
  return (
    <div className="infrastructure-settings-editor">
      <Editor title={title} {...props} />
    </div>
  );
}
export function Settings() {
  const q = useAPI<Resource<UnknownRecord>>('/api/admin/settings');
  const [tab, setTab] = useState('general');
  const discard = useDiscardSettings();
  const initial = q.data ? (q.data.attributes ?? q.data) : undefined;
  return (
    <div className="admin-infrastructure infrastructure-settings">
      <Heading title="Panel settings" />
      <ErrorMessage error={q.error} />
      {q.loading && !q.data ? (
        <Loading />
      ) : (
        <Tabs
          value={tab}
          onValueChange={async value => {
            if (value === null || value === tab) return;
            // The raw editor overlaps every form. Never save conflicting drafts.
            if ((value === 'advanced' || tab === 'advanced') && !(await discard())) return;
            setTab(String(value));
          }}
          className="panel-settings-tabs"
        >
          <TabsList variant="line" className="section-tabs" aria-label="Panel settings" activateOnFocus={false}>
            <TabsTrigger className="section-tab" value="general">
              General
            </TabsTrigger>
            <TabsTrigger className="section-tab" value="backups">
              Backups
            </TabsTrigger>
            <TabsTrigger className="section-tab" value="advanced">
              Advanced
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" keepMounted>
            <SettingsEditor
              title="Server defaults"
              groups={[
                {title: 'Wings', keys: ['pterodactyl:guzzle:connect_timeout', 'pterodactyl:guzzle:timeout']},
                {
                  title: 'Allocations',
                  keys: [
                    'pterodactyl:client_features:allocations:enabled',
                    'pterodactyl:client_features:allocations:range_start',
                    'pterodactyl:client_features:allocations:range_end',
                  ],
                },
                {
                  title: 'Databases',
                  keys: [
                    'pterodactyl:client_features:databases:enabled',
                    'pterodactyl:client_features:databases:allow_random',
                  ],
                },
                {
                  title: 'Limits & activity',
                  keys: [
                    'pterodactyl:client_features:schedules:per_schedule_task_limit',
                    'activity:hide_admin_activity',
                  ],
                },
              ]}
              endpoint="/api/admin/settings"
              initial={initial}
              fields={[
                f('pterodactyl:guzzle:connect_timeout', 'Connection timeout (seconds)', 'number', {
                  default: 5,
                  hint: 'Time allowed to connect to Wings.',
                }),
                f('pterodactyl:guzzle:timeout', 'Request timeout (seconds)', 'number', {
                  default: 60,
                  hint: 'Time allowed for a Wings request to finish.',
                }),
                f('pterodactyl:client_features:allocations:enabled', 'Automatic allocations', 'checkbox', {
                  hint: 'Let users assign ports from the range below.',
                }),
                f('pterodactyl:client_features:allocations:range_start', 'Port range start', 'number', {
                  default: 25565,
                }),
                f('pterodactyl:client_features:allocations:range_end', 'Port range end', 'number', {default: 26000}),
                f('pterodactyl:client_features:databases:enabled', 'Client database creation', 'checkbox', {
                  default: true,
                  hint: 'Let users create databases for their servers.',
                }),
                f('pterodactyl:client_features:databases:allow_random', 'Random host selection', 'checkbox', {
                  default: true,
                  hint: 'Choose an available host when creating a database.',
                }),
                f('pterodactyl:client_features:schedules:per_schedule_task_limit', 'Tasks per schedule', 'number', {
                  default: 10,
                }),
                f('activity:hide_admin_activity', 'Hide admin activity', 'checkbox', {
                  hint: "Keep administrator actions out of users' activity logs.",
                }),
              ]}
            />
          </TabsContent>
          <TabsContent value="backups" keepMounted>
            <BackupSettings initial={initial} />
          </TabsContent>
          <TabsContent value="advanced" keepMounted>
            <SettingsEditor
              title="All settings"
              endpoint="/api/admin/settings"
              initial={{settings: cleanSettings(initial ?? {})}}
              fields={[f('settings', 'Settings JSON', 'json')]}
              transform={v => cleanSettings(v.settings)}
            />
            <Disclosure className="card">
              <DisclosureTrigger>Optional panel artwork pack</DisclosureTrigger>
              <p>
                Set <code>ARTWORK_DIRECTORY</code> on the panel host to a private directory outside the web root,
                containing a <code>manifest.json</code> that maps server and library IDs to JPG, PNG or WebP files.
                Restart the panel during maintenance to apply pack changes. Web and desktop load the pack after sign-in
                and keep original SVG tiles as fallbacks. See <code>SERVER_ARTWORK.md</code> for the manifest format.
                Operators are responsible for permission to host their chosen artwork.
              </p>
            </Disclosure>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
function cleanSettings(settings: any): any {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([key]) => !key.endsWith('_configured') && !['app:name', 'app:locale', 'app:timezone'].includes(key))
      .map(([key, value]) => [key, cleanSettings(value)])
  );
}
function BackupSettings({initial}: {initial: any}) {
  return (
    <>
      <SettingsEditor
        title="Backup storage"
        endpoint="/api/admin/settings"
        initial={initial}
        fields={[
          f('backups.default', 'Storage provider', 'select', {
            default: 'wings',
            options: [
              {value: 'wings', label: 'Wings local storage'},
              {value: 's3', label: 'S3 compatible object storage'},
            ],
          }),
        ]}
      />
      <SettingsEditor
        title="S3 connection"
        endpoint="/api/admin/settings"
        initial={initial?.['backups.s3']}
        fields={[
          f('bucket', 'Bucket'),
          f('region', 'Region', undefined, {default: 'us-east-1'}),
          f('endpoint', 'Custom S3 endpoint'),
          f('access_key_id', 'Access key ID'),
          f('secret_access_key', 'Secret access key', 'password', {
            hint: initial?.['backups.s3']?.secret_access_key_configured
              ? 'A secret is configured. Leave blank to retain it.'
              : 'No secret configured.',
          }),
          f('session_token', 'Session token', 'password'),
          f('path_style', 'Use path style addressing', 'checkbox'),
          f('part_size', 'Multipart upload part size (bytes)', 'number', {
            default: 5 * 1024 * 1024,
          }),
        ]}
        transform={v => ({'backups.s3': v})}
      />
    </>
  );
}
