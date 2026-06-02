import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Copy,
  Eye,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPinned,
  Plus,
  Ruler,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import PanoramaViewer from './components/PanoramaViewer.jsx';
import { API_BASE, apiFetch } from './api.js';

function absoluteUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}

function BrandLogo({ compact = false }) {
  return (
    <div className={compact ? 'appLogo compact' : 'appLogo'}>
      <img src="/adinn-logo.png" alt="ADINN Advertising Services Ltd." />
    </div>
  );
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('fixture360_token') || '');
  const [publicProject, setPublicProject] = useState(null);
  const [screen, setScreen] = useState(token ? 'admin' : 'home');

  const handleLogin = (newToken) => {
    localStorage.setItem('fixture360_token', newToken);
    setToken(newToken);
    setScreen('admin');
  };

  const handleLogout = () => {
    localStorage.removeItem('fixture360_token');
    setToken('');
    setScreen('home');
  };

  if (screen === 'admin-login') return <AdminLogin onLogin={handleLogin} onBack={() => setScreen('home')} />;
  if (screen === 'admin') return <AdminDashboard onLogout={handleLogout} />;
  if (screen === 'client' && publicProject) {
    return <ClientPreview project={publicProject} onBack={() => setScreen('home')} />;
  }

  return (
    <HomeScreen
      onAdmin={() => setScreen('admin-login')}
      onProject={(project) => {
        setPublicProject(project);
        setScreen('client');
      }}
    />
  );
}

function HomeScreen({ onAdmin, onProject }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submitCode(event) {
    event.preventDefault();
    setError('');
    if (!code.trim()) {
      setError('Enter your unique preview code.');
      return;
    }
    try {
      setLoading(true);
      const data = await apiFetch(`/api/public/projects/${encodeURIComponent(code.trim())}`, {
        method: 'GET',
      });
      onProject(data.project);
    } catch (err) {
      setError(err.message || 'Preview code not found.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landing">
      <section className="landingCard glassCard">
        <BrandLogo />
        <div className="brandPill">Fixture360 Preview</div>
        <h1>View your shop fixture result</h1>
        <p className="lead">
          Enter the unique code shared with you to open your interactive 360° panorama, fixture placement, and measurement view.
        </p>

        <form className="codeForm" onSubmit={submitCode}>
          <label htmlFor="previewCode">Unique preview code</label>
          <input
            id="previewCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Example: DEMO360"
            autoFocus
          />
          {error ? <div className="errorText">{error}</div> : null}
          <button className="primaryBtn" disabled={loading} type="submit">
            <Eye size={18} />
            {loading ? 'Opening Preview...' : 'View Preview'}
          </button>
        </form>

        <div className="demoStrip">
          <span>Try sample:</span>
          <button type="button" onClick={() => setCode('DEMO360')}>DEMO360</button>
        </div>

        <button className="linkBtn adminAccess" onClick={onAdmin} type="button">
          <Lock size={16} /> Admin / Employee Login
        </button>
      </section>
    </main>
  );
}

function AdminLogin({ onLogin, onBack }) {
  const [form, setForm] = useState({ email: 'admin@fixture360.local', password: 'admin123' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      setLoading(true);
      const data = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onLogin(data.token);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landing compactLanding">
      <section className="glassCard loginCard">
        <button className="linkBtn" onClick={onBack} type="button"><ArrowLeft size={16} /> Back</button>
        <BrandLogo compact />
        <div className="iconBadge"><LayoutDashboard size={22} /></div>
        <h1>Admin Login</h1>
        <p className="muted">Create panorama projects, add measurements, place fixture previews, and share unique client codes.</p>
        <form className="stack" onSubmit={submit}>
          <label>Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label>Password</label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error ? <div className="errorText">{error}</div> : null}
          <button className="primaryBtn" disabled={loading} type="submit">
            <Lock size={18} /> {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </section>
    </main>
  );
}

function ClientPreview({ project, onBack }) {
  const [feedback, setFeedback] = useState({ name: '', message: '' });
  const [status, setStatus] = useState('');
  const imageUrl = absoluteUrl(project.panorama_url);

  async function sendFeedback(event) {
    event.preventDefault();
    setStatus('');
    if (!feedback.message.trim()) {
      setStatus('Please enter your feedback.');
      return;
    }
    try {
      await apiFetch(`/api/public/projects/${project.unique_code}/feedback`, {
        method: 'POST',
        body: JSON.stringify(feedback),
      });
      setStatus('Feedback submitted successfully.');
      setFeedback({ name: '', message: '' });
    } catch (err) {
      setStatus(err.message || 'Could not submit feedback.');
    }
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <BrandLogo compact />
          <button className="linkBtn" onClick={onBack} type="button"><ArrowLeft size={16} /> Back to code screen</button>
          <h1>{project.project_name}</h1>
          <p>{project.client_name} • {project.location || 'Location not added'} • Code: <strong>{project.unique_code}</strong></p>
        </div>
        <div className="statusPill">Client Preview</div>
      </header>

      <section className="gridLayout">
        <div className="viewerPanel">
          <PanoramaViewer
            imageUrl={imageUrl}
            measurements={project.measurements}
            fixtures={project.fixtures}
            height={660}
          />
        </div>
        <aside className="sidePanel">
          <InfoCard title="Shop Dimensions" icon={<MapPinned size={18} />}>
            <div className="metricGrid">
              <Metric label="Width" value={project.shop_width ? `${project.shop_width} ${project.unit}` : 'Not set'} />
              <Metric label="Length" value={project.shop_length ? `${project.shop_length} ${project.unit}` : 'Not set'} />
              <Metric label="Height" value={project.shop_height ? `${project.shop_height} ${project.unit}` : 'Not set'} />
            </div>
          </InfoCard>

          <InfoCard title="Measurements" icon={<Ruler size={18} />}>
            <ItemList
              items={project.measurements}
              empty="No measurements added yet."
              render={(item) => (
                <>
                  <strong>{item.side_name}</strong>
                  <span>{item.width} {item.unit} W × {item.height} {item.unit} H</span>
                </>
              )}
            />
          </InfoCard>

          <InfoCard title="Fixtures" icon={<Box size={18} />}>
            <ItemList
              items={project.fixtures}
              empty="No fixtures added yet."
              render={(item) => (
                <>
                  <strong>{item.fixture_name}</strong>
                  <span>{item.fixture_type || 'Fixture'} • {item.width || '-'} W × {item.height || '-'} H</span>
                </>
              )}
            />
          </InfoCard>

          <InfoCard title="Client Feedback" icon={<Send size={18} />}>
            <form className="stack" onSubmit={sendFeedback}>
              <input placeholder="Your name" value={feedback.name} onChange={(e) => setFeedback({ ...feedback, name: e.target.value })} />
              <textarea placeholder="Add feedback or approval note" value={feedback.message} onChange={(e) => setFeedback({ ...feedback, message: e.target.value })} />
              {status ? <div className="hintText">{status}</div> : null}
              <button className="primaryBtn" type="submit"><Send size={16} /> Submit Feedback</button>
            </form>
          </InfoCard>
        </aside>
      </section>
    </main>
  );
}

function AdminDashboard({ onLogout }) {
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadProjects() {
    setError('');
    try {
      setLoading(true);
      const data = await apiFetch('/api/admin/projects');
      setProjects(data.projects || []);
    } catch (err) {
      setError(err.message || 'Could not load projects.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  if (activeId) {
    return (
      <ProjectEditor
        projectId={activeId}
        onBack={() => {
          setActiveId(null);
          loadProjects();
        }}
        onLogout={onLogout}
      />
    );
  }

  return (
    <main className="appShell adminShell">
      <header className="topBar">
        <div>
          <BrandLogo compact />
          <div className="brandPill">Admin Workspace</div>
          <h1>Fixture360 Projects</h1>
          <p>Create a client project, upload panorama, add measurements, and share the unique code.</p>
        </div>
        <button className="secondaryBtn" onClick={onLogout} type="button"><LogOut size={16} /> Logout</button>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="adminGrid">
        <CreateProjectCard onCreated={(project) => { loadProjects(); setActiveId(project.id); }} />
        <div className="panelCard">
          <div className="sectionTitle">
            <h2>All Projects</h2>
            <span>{loading ? 'Loading...' : `${projects.length} total`}</span>
          </div>
          <div className="projectList">
            {projects.map((project) => (
              <button key={project.id} className="projectRow" onClick={() => setActiveId(project.id)} type="button">
                <div>
                  <strong>{project.project_name}</strong>
                  <span>{project.client_name} • {project.location || 'No location'}</span>
                </div>
                <div className="rowMeta">
                  <code>{project.unique_code}</code>
                  <small>{project.status}</small>
                </div>
              </button>
            ))}
            {!loading && projects.length === 0 ? <div className="emptyState">No projects yet.</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function CreateProjectCard({ onCreated }) {
  const [form, setForm] = useState({
    project_name: '',
    client_name: '',
    client_phone: '',
    location: '',
    shop_width: '',
    shop_length: '',
    shop_height: '',
    unit: 'ft',
  });
  const [panorama, setPanorama] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!panorama) {
      setError('Please upload a panorama image.');
      return;
    }
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    data.append('panorama', panorama);
    try {
      setLoading(true);
      const response = await apiFetch('/api/admin/projects', {
        method: 'POST',
        body: data,
        headers: {},
      });
      onCreated(response.project);
    } catch (err) {
      setError(err.message || 'Could not create project.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panelCard">
      <div className="sectionTitle">
        <h2>Create Project</h2>
        <Plus size={18} />
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="twoCol">
          <Field label="Project Name" value={form.project_name} onChange={(value) => setForm({ ...form, project_name: value })} required />
          <Field label="Client Name" value={form.client_name} onChange={(value) => setForm({ ...form, client_name: value })} required />
        </div>
        <div className="twoCol">
          <Field label="Client Phone" value={form.client_phone} onChange={(value) => setForm({ ...form, client_phone: value })} />
          <Field label="Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} />
        </div>
        <div className="fourCol">
          <Field label="Width" type="number" value={form.shop_width} onChange={(value) => setForm({ ...form, shop_width: value })} />
          <Field label="Length" type="number" value={form.shop_length} onChange={(value) => setForm({ ...form, shop_length: value })} />
          <Field label="Height" type="number" value={form.shop_height} onChange={(value) => setForm({ ...form, shop_height: value })} />
          <label className="field"><span>Unit</span><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option>ft</option><option>m</option><option>cm</option></select></label>
        </div>
        <label className="uploadBox">
          <Upload size={18} />
          <span>{panorama ? panorama.name : 'Upload panorama image'}</span>
          <input type="file" accept="image/*" onChange={(e) => setPanorama(e.target.files?.[0] || null)} />
        </label>
        {error ? <div className="errorText">{error}</div> : null}
        <button className="primaryBtn" disabled={loading} type="submit"><Upload size={16} /> {loading ? 'Creating...' : 'Create Project'}</button>
      </form>
    </div>
  );
}

function ProjectEditor({ projectId, onBack, onLogout }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [measurementPlacement, setMeasurementPlacement] = useState({ active: false, point: null });

  async function loadProject() {
    setError('');
    try {
      const data = await apiFetch(`/api/admin/projects/${projectId}`);
      setProject(data.project);
    } catch (err) {
      setError(err.message || 'Could not load project.');
    }
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  async function updateStatus(status) {
    try {
      setSaving(true);
      const data = await apiFetch(`/api/admin/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setProject(data.project);
    } catch (err) {
      setError(err.message || 'Could not update status.');
    } finally {
      setSaving(false);
    }
  }

  async function removeProject() {
    if (!window.confirm('Delete this project?')) return;
    await apiFetch(`/api/admin/projects/${projectId}`, { method: 'DELETE' });
    onBack();
  }

  if (!project) {
    return (
      <main className="appShell">
        <button className="linkBtn" onClick={onBack} type="button"><ArrowLeft size={16} /> Back</button>
        {error ? <div className="errorBanner">{error}</div> : <div className="emptyState">Loading project...</div>}
      </main>
    );
  }

  const imageUrl = absoluteUrl(project.panorama_url);
  const previewUrl = `${window.location.origin}`;

  return (
    <main className="appShell adminShell">
      <header className="topBar">
        <div>
          <BrandLogo compact />
          <button className="linkBtn" onClick={onBack} type="button"><ArrowLeft size={16} /> Back to projects</button>
          <h1>{project.project_name}</h1>
          <p>{project.client_name} • Code: <strong>{project.unique_code}</strong> • Created {formatDate(project.created_at)}</p>
        </div>
        <div className="headerActions">
          <button className="secondaryBtn" onClick={() => navigator.clipboard.writeText(project.unique_code)} type="button"><Copy size={16} /> Copy Code</button>
          <button className="secondaryBtn" onClick={() => navigator.clipboard.writeText(previewUrl)} type="button"><Copy size={16} /> Copy Site Link</button>
          <button className="secondaryBtn" onClick={onLogout} type="button"><LogOut size={16} /> Logout</button>
        </div>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="editorGrid">
        <div className="viewerPanel stickyViewer">
          <PanoramaViewer
            imageUrl={imageUrl}
            measurements={project.measurements}
            fixtures={project.fixtures}
            height={720}
            placementMode={measurementPlacement.active}
            selectionPoint={measurementPlacement.point}
            selectionLabel="New Measurement"
            onPickPoint={(point) => setMeasurementPlacement({ active: false, point })}
          />
        </div>
        <aside className="editorPanel">
          <div className="panelCard compactCard">
            <div className="sectionTitle">
              <h2>Preview Access</h2>
              <span className="statusPill">{project.status}</span>
            </div>
            <div className="codeDisplay">{project.unique_code}</div>
            <p className="muted">Share this code with the client. They can enter it on the first screen to view the result.</p>
            <div className="buttonRow">
              <button className="primaryBtn" disabled={saving} onClick={() => updateStatus('published')} type="button">Publish</button>
              <button className="secondaryBtn danger" onClick={removeProject} type="button"><Trash2 size={16} /> Delete</button>
            </div>
          </div>

          <MeasurementManager
            project={project}
            onChange={setProject}
            pickedPoint={measurementPlacement.point}
            isPicking={measurementPlacement.active}
            onStartPicking={() => setMeasurementPlacement((current) => ({ ...current, active: true }))}
            onCancelPicking={() => setMeasurementPlacement((current) => ({ ...current, active: false }))}
            onClearPicked={() => setMeasurementPlacement({ active: false, point: null })}
          />
          <FixtureManager project={project} onChange={setProject} />
          <FeedbackList feedback={project.feedback || []} />
        </aside>
      </section>
    </main>
  );
}

function MeasurementManager({
  project,
  onChange,
  pickedPoint,
  isPicking,
  onStartPicking,
  onCancelPicking,
  onClearPicked,
}) {
  const defaultUnit = project.unit || 'ft';
  const emptyForm = {
    side_name: '',
    width: '',
    height: '',
    unit: defaultUnit,
    yaw: '',
    pitch: '',
    remarks: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm((current) => ({ ...current, unit: current.unit || defaultUnit }));
  }, [defaultUnit]);

  useEffect(() => {
    if (!pickedPoint) return;
    setForm((current) => ({
      ...current,
      yaw: String(pickedPoint.yaw),
      pitch: String(pickedPoint.pitch),
    }));
    setSuccess('Position selected. Add the size and save the measurement.');
  }, [pickedPoint]);

  function applyPreset(label, width = '', height = '', remarks = '') {
    setForm((current) => ({
      ...current,
      side_name: label,
      width: width || current.width,
      height: height || current.height || project.shop_height || '',
      remarks: remarks || current.remarks,
    }));
  }

  function editMeasurement(item) {
    setEditingId(item.id);
    setForm({
      side_name: item.side_name || '',
      width: item.width || '',
      height: item.height || '',
      unit: item.unit || defaultUnit,
      yaw: item.yaw ?? '',
      pitch: item.pitch ?? '',
      remarks: item.remarks || '',
    });
    onClearPicked?.();
    setError('');
    setSuccess('Editing measurement. You can also click Place / Reposition to move it.');
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm, unit: defaultUnit });
    setError('');
    setSuccess('');
    onClearPicked?.();
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    const payload = {
      side_name: form.side_name.trim(),
      width: Number(form.width),
      height: Number(form.height),
      unit: form.unit || defaultUnit,
      yaw: Number(form.yaw),
      pitch: Number(form.pitch),
      remarks: form.remarks || null,
    };

    if (!payload.side_name) {
      setError('Enter a label name, for example Front Wall, Door, Shelf Area, or Ceiling Height.');
      return;
    }
    if (!payload.width || !payload.height || payload.width <= 0 || payload.height <= 0) {
      setError('Enter width and height values greater than 0.');
      return;
    }
    if (Number.isNaN(payload.yaw) || Number.isNaN(payload.pitch)) {
      setError('Click Place / Reposition, then click the exact point inside the panorama.');
      return;
    }

    try {
      setSaving(true);
      const url = editingId
        ? `/api/admin/measurements/${editingId}`
        : `/api/admin/projects/${project.id}/measurements`;
      const data = await apiFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      onChange(data.project);
      setEditingId(null);
      setForm({ ...emptyForm, unit: payload.unit });
      onClearPicked?.();
      setSuccess(editingId ? 'Measurement updated.' : 'Measurement added. You can add another one anywhere in the shop.');
    } catch (err) {
      setError(err.message || 'Could not save measurement.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    const data = await apiFetch(`/api/admin/measurements/${id}`, { method: 'DELETE' });
    onChange(data.project);
    if (editingId === id) resetForm();
  }

  const presets = [
    { label: 'Front Wall', width: project.shop_width || '' },
    { label: 'Right Wall', width: project.shop_length || '' },
    { label: 'Back Wall', width: project.shop_width || '' },
    { label: 'Left Wall', width: project.shop_length || '' },
    { label: 'Door', width: '', height: '' },
    { label: 'Shelf Area', width: '', height: '' },
    { label: 'Ceiling Height', width: project.shop_width || '', height: project.shop_height || '' },
  ];

  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Dynamic Measurements</h2><Ruler size={18} /></div>
      <p className="muted smallCopy">
        Add measurements anywhere: type the label and size, click Place / Reposition, then click the exact spot inside the 360° viewer.
      </p>

      <div className="quickChips">
        {presets.map((preset) => (
          <button
            key={preset.label}
            className="chipBtn"
            type="button"
            onClick={() => applyPreset(preset.label, preset.width, preset.height)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form className="stack" onSubmit={submit}>
        <div className="twoCol">
          <Field label="Measurement Label" value={form.side_name} onChange={(value) => setForm({ ...form, side_name: value })} required />
          <label className="field">
            <span>Unit</span>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              <option>ft</option>
              <option>m</option>
              <option>cm</option>
              <option>inch</option>
            </select>
          </label>
        </div>

        <div className="twoCol">
          <Field label="Width / Length" type="number" value={form.width} onChange={(value) => setForm({ ...form, width: value })} required />
          <Field label="Height" type="number" value={form.height} onChange={(value) => setForm({ ...form, height: value })} required />
        </div>

        <div className="placementBox">
          <div>
            <strong>{form.yaw !== '' && form.pitch !== '' ? 'Position selected' : 'Position not selected'}</strong>
            <span>
              {form.yaw !== '' && form.pitch !== ''
                ? `Yaw ${form.yaw}°, Pitch ${form.pitch}°`
                : 'Click the button, then click the panorama preview.'}
            </span>
          </div>
          <div className="placementActions">
            <button className="secondaryBtn" type="button" onClick={isPicking ? onCancelPicking : onStartPicking}>
              {isPicking ? 'Cancel Click Mode' : 'Place / Reposition'}
            </button>
          </div>
        </div>

        {isPicking ? (
          <div className="activePickNotice">Now click once on the viewer where this measurement label should appear.</div>
        ) : null}

        <textarea placeholder="Optional remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />

        {error ? <div className="errorText">{error}</div> : null}
        {success ? <div className="hintText">{success}</div> : null}

        <div className="buttonRow">
          <button className="primaryBtn" disabled={saving} type="submit">
            <Plus size={16} /> {saving ? 'Saving...' : editingId ? 'Update Measurement' : 'Add Measurement'}
          </button>
          {editingId ? <button className="secondaryBtn" type="button" onClick={resetForm}>Cancel Edit</button> : null}
        </div>
      </form>

      <ItemList
        items={project.measurements}
        empty="No measurements added yet. Add labels anywhere using click placement."
        render={(item) => (
          <>
            <div>
              <strong>{item.side_name}</strong>
              <span>{item.width} {item.unit} W × {item.height} {item.unit} H</span>
              <small>Position: yaw {item.yaw}°, pitch {item.pitch}°</small>
            </div>
            <div className="miniActions">
              <button className="tinyBtn" onClick={() => editMeasurement(item)} type="button">Edit</button>
              <button className="tinyDanger" onClick={() => remove(item.id)} type="button"><Trash2 size={14} /></button>
            </div>
          </>
        )}
      />
    </div>
  );
}

function FixtureManager({ project, onChange }) {
  const [form, setForm] = useState({
    fixture_name: '',
    fixture_type: 'Wall Display',
    width: '',
    height: '',
    depth: '',
    unit: project.unit || 'ft',
    yaw: 0,
    pitch: -5,
    scale: 1,
    color: '#CF1E01',
    remarks: '',
  });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        width: form.width ? Number(form.width) : null,
        height: form.height ? Number(form.height) : null,
        depth: form.depth ? Number(form.depth) : null,
        yaw: Number(form.yaw),
        pitch: Number(form.pitch),
        scale: Number(form.scale),
      };
      const data = await apiFetch(`/api/admin/projects/${project.id}/fixtures`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onChange(data.project);
      setForm({ ...form, fixture_name: '', width: '', height: '', depth: '', remarks: '' });
    } catch (err) {
      setError(err.message || 'Could not add fixture.');
    }
  }

  async function remove(id) {
    const data = await apiFetch(`/api/admin/fixtures/${id}`, { method: 'DELETE' });
    onChange(data.project);
  }

  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Fixture Overlay</h2><Box size={18} /></div>
      <form className="stack" onSubmit={submit}>
        <div className="twoCol">
          <Field label="Fixture Name" value={form.fixture_name} onChange={(value) => setForm({ ...form, fixture_name: value })} required />
          <label className="field"><span>Type</span><select value={form.fixture_type} onChange={(e) => setForm({ ...form, fixture_type: e.target.value })}><option>Wall Display</option><option>Gondola Rack</option><option>Counter Display</option><option>Island Display</option><option>Branding Panel</option></select></label>
        </div>
        <div className="fourCol">
          <Field label="Width" type="number" value={form.width} onChange={(value) => setForm({ ...form, width: value })} />
          <Field label="Height" type="number" value={form.height} onChange={(value) => setForm({ ...form, height: value })} />
          <Field label="Depth" type="number" value={form.depth} onChange={(value) => setForm({ ...form, depth: value })} />
          <Field label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} />
        </div>
        <Slider label={`Yaw ${form.yaw}°`} value={form.yaw} min="-180" max="180" onChange={(value) => setForm({ ...form, yaw: value })} />
        <Slider label={`Pitch ${form.pitch}°`} value={form.pitch} min="-70" max="70" onChange={(value) => setForm({ ...form, pitch: value })} />
        <Slider label={`Scale ${form.scale}`} value={form.scale} min="0.5" max="2" step="0.1" onChange={(value) => setForm({ ...form, scale: value })} />
        <label className="field"><span>Fixture Color</span><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
        <textarea placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        {error ? <div className="errorText">{error}</div> : null}
        <button className="primaryBtn" type="submit"><Plus size={16} /> Add Fixture</button>
      </form>
      <ItemList
        items={project.fixtures}
        empty="No fixtures added."
        render={(item) => (
          <>
            <strong>{item.fixture_name}</strong>
            <span>{item.fixture_type || 'Fixture'} • yaw {item.yaw}° • scale {item.scale}</span>
            <button className="tinyDanger" onClick={() => remove(item.id)} type="button"><Trash2 size={14} /></button>
          </>
        )}
      />
    </div>
  );
}

function FeedbackList({ feedback }) {
  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Client Feedback</h2><Send size={18} /></div>
      <ItemList
        items={feedback}
        empty="No feedback submitted yet."
        render={(item) => (
          <>
            <strong>{item.name || 'Client'}</strong>
            <span>{item.message}</span>
            <small>{formatDate(item.created_at)}</small>
          </>
        )}
      />
    </div>
  );
}

function InfoCard({ title, icon, children }) {
  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>{title}</h2>{icon}</div>
      {children}
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ItemList({ items = [], empty, render }) {
  if (!items.length) return <div className="emptyState smallEmpty">{empty}</div>;
  return (
    <div className="itemList">
      {items.map((item) => (
        <div className="miniItem" key={item.id}>
          {render(item)}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
    </label>
  );
}

function Slider({ label, value, onChange, min, max, step = '1' }) {
  return (
    <label className="field sliderField">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default App;
