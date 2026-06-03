import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Box,
  CalendarClock,
  Copy,
  Eye,
  FileText,
  Image as ImageIcon,
  Layers,
  Lock,
  LogOut,
  MapPinned,
  Plus,
  Ruler,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
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

function QualityStrip() {
  return (
    <div className="qualityStrip">
      <span>360° Preview</span>
      <span>Fixture Layout</span>
      <span>Measurement View</span>
      <span>Secure Code Access</span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return 'Not set';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function validityDurationText(project) {
  const days = Number(project?.valid_days || 0);
  const hours = Number(project?.valid_hours || 0);
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' ') : 'Not set';
}

function viewLimitText(project) {
  const max = Number(project?.max_views || 0);
  if (!max) return 'Unlimited';
  const used = Number(project?.current_code_view_count || 0);
  return `${used}/${max} used`;
}

function hasPermission(user, permission) {
  return user?.role === 'admin' || Boolean(user?.permissions?.[permission]);
}

function dimensionsText(item, unitFallback = 'ft') {
  const unit = item.unit || unitFallback;
  const parts = [];
  if (item.width) parts.push(`${item.width} ${unit} W`);
  if (item.height) parts.push(`${item.height} ${unit} H`);
  if (item.depth) parts.push(`${item.depth} ${unit} D`);
  return parts.length ? parts.join(' × ') : 'Size not added';
}

function mediaLabel(type) {
  if (type === 'site_photo') return 'Site Photo';
  if (type === 'ricky_image' || type === 'recce_image') return 'Ricky Image';
  if (type === 'diagram_pdf') return '2D Diagram';
  if (type === 'panorama') return '3D Panorama';
  return 'Media';
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
  const [form, setForm] = useState({ code: '', name: '', company_name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submitCode(event) {
    event.preventDefault();
    setError('');
    if (!form.code.trim() || !form.name.trim() || !form.company_name.trim()) {
      setError('Enter your preview code, name, and company name.');
      return;
    }
    try {
      setLoading(true);
      const data = await apiFetch('/api/public/access', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          company_name: form.company_name.trim(),
        }),
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
        <div className="brandPill">ADINN Fixture360</div>
        <h1>View your 360° fixture preview</h1>
        <p className="lead">
          Enter the unique code shared by ADINN along with your name and company to open the interactive shop preview.
        </p>

        <form className="codeForm" onSubmit={submitCode}>
          <label htmlFor="previewCode">Unique preview code</label>
          <input
            id="previewCode"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            placeholder="Enter preview code"
            autoComplete="off"
            autoFocus
          />
          <div className="twoCol cleanTwoCol">
            <label className="field"><span>Your Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="field"><span>Company Name</span><input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required /></label>
          </div>
          {error ? <div className="errorText">{error}</div> : null}
          <button className="primaryBtn" disabled={loading} type="submit">
            <Eye size={18} />
            {loading ? 'Opening Preview...' : 'View Preview'}
          </button>
        </form>

        <QualityStrip />

        <button className="linkBtn adminAccess" onClick={onAdmin} type="button">
          <Lock size={16} /> Team Login
        </button>
      </section>
    </main>
  );
}

function AdminLogin({ onLogin, onBack }) {
  const [form, setForm] = useState({ email: '', password: '' });
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
        <h1>Team Login</h1>
        <p className="muted">Admin and permitted employees can create projects, add media, manage measurements, and share preview codes.</p>
        <form className="stack" onSubmit={submit}>
          <label>Email</label>
          <input name="fixture360_team_email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label>Password</label>
          <input type="password" name="fixture360_team_password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
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
  const [feedback, setFeedback] = useState({ name: '', company_name: '', message: '' });
  const [status, setStatus] = useState('');
  const mediaItems = useMemo(() => project.media?.length ? project.media : (project.panorama_url ? [{ id: 'legacy-panorama', type: 'panorama', label: '3D View', url: project.panorama_url }] : []), [project]);
  const [activeMediaId, setActiveMediaId] = useState(mediaItems[0]?.id || '');
  const activeMedia = mediaItems.find((item) => item.id === activeMediaId) || mediaItems[0];

  useEffect(() => {
    if (mediaItems.length && !mediaItems.find((item) => item.id === activeMediaId)) {
      setActiveMediaId(mediaItems[0].id);
    }
  }, [mediaItems, activeMediaId]);

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
      setFeedback({ name: '', company_name: '', message: '' });
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
        <div className="statusStack">
          <div className="statusPill">Client Preview</div>
          <small>Valid for {validityDurationText(project)} • Until {formatDate(project.valid_until)}</small>
        </div>
      </header>

      <section className="mediaTabs">
        {mediaItems.map((item, index) => (
          <button key={item.id} className={item.id === activeMedia?.id ? 'mediaTab active' : 'mediaTab'} onClick={() => setActiveMediaId(item.id)} type="button">
            {item.type === 'panorama' ? <Layers size={15} /> : item.type === 'diagram_pdf' ? <FileText size={15} /> : <ImageIcon size={15} />}
            {index + 1}. {item.label || mediaLabel(item.type)}
          </button>
        ))}
      </section>

      <section className="gridLayout">
        <div className="viewerPanel">
          <MediaPreview
            media={activeMedia}
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
                  <span>{dimensionsText(item, project.unit)}</span>
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
                  <span>{item.fixture_type || 'Fixture'} • {dimensionsText(item, project.unit)}</span>
                </>
              )}
            />
          </InfoCard>

          <InfoCard title="Client Feedback" icon={<Send size={18} />}>
            <form className="stack" onSubmit={sendFeedback}>
              <input placeholder="Your name" value={feedback.name} onChange={(e) => setFeedback({ ...feedback, name: e.target.value })} />
              <input placeholder="Company name" value={feedback.company_name} onChange={(e) => setFeedback({ ...feedback, company_name: e.target.value })} />
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

function MediaPreview({ media, measurements = [], fixtures = [], height = 640, placementMode = false, selectionPoint = null, selectionLabel = 'New Measurement', onPickPoint }) {
  if (!media) return <div className="mediaEmpty" style={{ height }}>No media available.</div>;
  const url = absoluteUrl(media.url);
  if (media.type === 'panorama') {
    return <PanoramaViewer imageUrl={url} measurements={measurements} fixtures={fixtures} height={height} placementMode={placementMode} selectionPoint={selectionPoint} selectionLabel={selectionLabel} onPickPoint={onPickPoint} />;
  }
  if (media.type === 'diagram_pdf') {
    return (
      <div className="documentViewer" style={{ height }}>
        <iframe src={url} title={media.label || '2D Diagram'} />
        <a className="secondaryBtn docOpenBtn" href={url} target="_blank" rel="noreferrer">Open PDF</a>
      </div>
    );
  }
  return (
    <div className="imageViewer" style={{ height }}>
      <img src={url} alt={media.label || 'Actual shop'} />
    </div>
  );
}

function AdminDashboard({ onLogout }) {
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadProjects() {
    setError('');
    try {
      setLoading(true);
      const me = await apiFetch('/api/admin/me');
      setUser(me.user);
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
        currentUser={user}
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
          <div className="brandPill">Company Workspace</div>
          <h1>Fixture360 Projects</h1>
          <p>Create client projects, set code validity, upload media, and track viewers.</p>
          {user ? <p className="tinyMeta">Logged in as {user.name} • {user.role}</p> : null}
        </div>
        <button className="secondaryBtn" onClick={onLogout} type="button"><LogOut size={16} /> Logout</button>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="statsGrid">
        <Metric label="Projects" value={loading ? '...' : projects.length} />
        <Metric label="Total Viewers" value={projects.reduce((sum, project) => sum + Number(project.viewer_count || 0), 0)} />
        <Metric label="Active Codes" value={projects.filter((project) => !project.is_expired).length} />
      </section>

      <section className="adminGrid">
        {hasPermission(user, 'create_project') ? <CreateProjectCard onCreated={(project) => { loadProjects(); setActiveId(project.id); }} /> : <PermissionCard message="You do not have permission to create projects." />}
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
                  <small>Created by {project.created_by?.name || 'Unknown'} ({project.created_by?.employee_id || 'No ID'})</small>
                </div>
                <div className="rowMeta">
                  <code>{project.unique_code}</code>
                  <small>{project.viewer_count || 0} viewers</small>
                  <small>{project.is_expired ? 'Expired' : `Valid for ${validityDurationText(project)} • Until ${formatDate(project.valid_until)}`}</small>
                </div>
              </button>
            ))}
            {!loading && projects.length === 0 ? <div className="emptyState">No projects yet.</div> : null}
          </div>
        </div>
      </section>

      {user?.role === 'admin' ? <EmployeeManager /> : null}
    </main>
  );
}

function PermissionCard({ message }) {
  return <div className="panelCard"><div className="sectionTitle"><h2>Permission Required</h2><ShieldCheck size={18} /></div><p className="muted">{message}</p></div>;
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
    validity_days: '30',
    validity_hours: '0',
    max_views: '0',
  });
  const [sitePhotos, setSitePhotos] = useState([]);
  const [sitePhotoLabels, setSitePhotoLabels] = useState([]);
  const [rickyImages, setRickyImages] = useState([]);
  const [rickyImageLabels, setRickyImageLabels] = useState([]);
  const [diagramPdfs, setDiagramPdfs] = useState([]);
  const [diagramPdfLabels, setDiagramPdfLabels] = useState([]);
  const [panoramaImages, setPanoramaImages] = useState([]);
  const [panoramaImageLabels, setPanoramaImageLabels] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!panoramaImages.length) {
      setError('Please upload at least one panoramic image.');
      return;
    }
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    sitePhotos.forEach((file, index) => {
      data.append('site_photos', file);
      data.append('site_photo_labels', sitePhotoLabels[index] || file.name);
    });
    rickyImages.forEach((file, index) => {
      data.append('ricky_images', file);
      data.append('ricky_image_labels', rickyImageLabels[index] || file.name);
    });
    diagramPdfs.forEach((file, index) => {
      data.append('diagram_pdfs', file);
      data.append('diagram_pdf_labels', diagramPdfLabels[index] || file.name);
    });
    panoramaImages.forEach((file, index) => {
      data.append('panorama_images', file);
      data.append('panorama_image_labels', panoramaImageLabels[index] || `3D View ${index + 1}`);
    });
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
      <div className="sectionTitle"><h2>Create Project</h2><Plus size={18} /></div>
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
          <label className="field"><span>Unit</span><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option>ft</option><option>m</option><option>cm</option><option>inch</option></select></label>
        </div>
        <div className="threeCol"><Field label="Code Validity - Days" type="number" value={form.validity_days} onChange={(value) => setForm({ ...form, validity_days: value })} required /><Field label="Code Validity - Hours" type="number" value={form.validity_hours} onChange={(value) => setForm({ ...form, validity_hours: value })} required /><Field label="Max Views per Code" type="number" value={form.max_views} onChange={(value) => setForm({ ...form, max_views: value })} /></div>
        <NamedFileUpload label="Site Photo (PNG/JPG)" accept="image/*" multiple files={sitePhotos} labels={sitePhotoLabels} onChange={setSitePhotos} onLabelsChange={setSitePhotoLabels} namePlaceholder="Example: Front exterior photo" />
        <NamedFileUpload label="Ricky Image / Actual Reference Photo (PNG/JPG)" accept="image/*" multiple files={rickyImages} labels={rickyImageLabels} onChange={setRickyImages} onLabelsChange={setRickyImageLabels} namePlaceholder="Example: Inside left wall" />
        <NamedFileUpload label="2D Diagram (PDF)" accept="application/pdf" multiple files={diagramPdfs} labels={diagramPdfLabels} onChange={setDiagramPdfs} onLabelsChange={setDiagramPdfLabels} namePlaceholder="Example: Front elevation drawing" />
        <NamedFileUpload label="Panoramic Images for 3D Views (PNG/JPG)" accept="image/*" multiple files={panoramaImages} labels={panoramaImageLabels} onChange={setPanoramaImages} onLabelsChange={setPanoramaImageLabels} namePlaceholder="Example: 3D View 1 - Entrance" required />
        {error ? <div className="errorText">{error}</div> : null}
        <button className="primaryBtn" disabled={loading} type="submit"><Upload size={16} /> {loading ? 'Creating...' : 'Create Project'}</button>
      </form>
    </div>
  );
}

function ProjectEditor({ projectId, currentUser, onBack, onLogout }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [measurementPlacement, setMeasurementPlacement] = useState({ active: false, point: null });
  const [activeMediaId, setActiveMediaId] = useState('');
  const [validityForm, setValidityForm] = useState({ valid_days: '30', valid_hours: '0', max_views: '0' });
  const [notice, setNotice] = useState('');

  async function loadProject() {
    setError('');
    try {
      const data = await apiFetch(`/api/admin/projects/${projectId}`);
      setProject(data.project);
      const firstMedia = data.project.media?.[0];
      if (firstMedia) setActiveMediaId(firstMedia.id);
    } catch (err) {
      setError(err.message || 'Could not load project.');
    }
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (project) {
      setValidityForm({
        valid_days: String(project.valid_days ?? 30),
        valid_hours: String(project.valid_hours ?? 0),
        max_views: String(project.max_views ?? 0),
      });
    }
  }, [project?.id, project?.valid_days, project?.valid_hours, project?.max_views]);

  async function updateStatus(status) {
    try {
      setSaving(true);
      const data = await apiFetch(`/api/admin/projects/${projectId}`, { method: 'PUT', body: JSON.stringify({ status }) });
      setProject(data.project);
    } catch (err) {
      setError(err.message || 'Could not update status.');
    } finally {
      setSaving(false);
    }
  }

  async function updateCodeValidity() {
    try {
      setSaving(true);
      const data = await apiFetch(`/api/admin/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          valid_days: Number(validityForm.valid_days || 0),
          valid_hours: Number(validityForm.valid_hours || 0),
          max_views: Number(validityForm.max_views || 0),
        }),
      });
      const oldCode = project.unique_code;
      setProject(data.project);
      setNotice(data.project.unique_code !== oldCode ? `New preview code generated: ${data.project.unique_code}` : 'Preview access updated.');
    } catch (err) {
      setError(err.message || 'Could not update code validity.');
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
    return <main className="appShell"><button className="linkBtn" onClick={onBack} type="button"><ArrowLeft size={16} /> Back</button>{error ? <div className="errorBanner">{error}</div> : <div className="emptyState">Loading project...</div>}</main>;
  }

  const mediaItems = project.media?.length ? project.media : (project.panorama_url ? [{ id: 'legacy-panorama', type: 'panorama', label: '3D View', url: project.panorama_url }] : []);
  const activeMedia = mediaItems.find((item) => item.id === activeMediaId) || mediaItems[0];
  const previewUrl = `${window.location.origin}`;

  return (
    <main className="appShell adminShell">
      <header className="topBar">
        <div>
          <BrandLogo compact />
          <button className="linkBtn" onClick={onBack} type="button"><ArrowLeft size={16} /> Back to projects</button>
          <h1>{project.project_name}</h1>
          <p>{project.client_name} • Code: <strong>{project.unique_code}</strong> • Created by {project.created_by?.name || 'Unknown'} ({project.created_by?.employee_id || 'No ID'})</p>
        </div>
        <div className="headerActions">
          <button className="secondaryBtn" onClick={() => navigator.clipboard.writeText(project.unique_code)} type="button"><Copy size={16} /> Copy Code</button>
          <button className="secondaryBtn" onClick={() => navigator.clipboard.writeText(previewUrl)} type="button"><Copy size={16} /> Copy Site Link</button>
          <button className="secondaryBtn" onClick={onLogout} type="button"><LogOut size={16} /> Logout</button>
        </div>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="mediaTabs">
        {mediaItems.map((item, index) => (
          <button key={item.id} className={item.id === activeMedia?.id ? 'mediaTab active' : 'mediaTab'} onClick={() => setActiveMediaId(item.id)} type="button">
            {item.type === 'panorama' ? <Layers size={15} /> : item.type === 'diagram_pdf' ? <FileText size={15} /> : <ImageIcon size={15} />}
            {index + 1}. {item.label || mediaLabel(item.type)}
          </button>
        ))}
      </section>

      <section className="editorGrid">
        <div className="viewerPanel stickyViewer">
          <MediaPreview
            media={activeMedia}
            measurements={project.measurements}
            fixtures={project.fixtures}
            height={720}
            placementMode={activeMedia?.type === 'panorama' && measurementPlacement.active}
            selectionPoint={activeMedia?.type === 'panorama' ? measurementPlacement.point : null}
            selectionLabel="New Measurement"
            onPickPoint={(point) => setMeasurementPlacement({ active: false, point })}
          />
        </div>
        <aside className="editorPanel">
          <div className="panelCard compactCard">
            <div className="sectionTitle"><h2>Preview Access</h2><span className="statusPill">{project.status}</span></div>
            <div className="codeDisplay">{project.unique_code}</div>
            <div className="metricGrid">
              <Metric label="Project Viewers" value={project.viewer_count || 0} />
              <Metric label="Current Code Views" value={viewLimitText(project)} />
              <Metric label="Remaining Views" value={project.remaining_views === null || project.remaining_views === undefined ? 'Unlimited' : project.remaining_views} />
              <Metric label="Validity" value={validityDurationText(project)} />
              <Metric label="Valid Until" value={formatDate(project.valid_until)} />
              <Metric label="3D Views" value={project.panoramas?.length || 0} />
            </div>
            <p className="muted">Client must enter code, name, and company name before viewing.</p>
            {hasPermission(currentUser, 'publish_project') ? (
              <div className="validityEditor">
                <div className="threeCol">
                  <Field label="Days" type="number" value={validityForm.valid_days} onChange={(value) => setValidityForm({ ...validityForm, valid_days: value })} />
                  <Field label="Hours" type="number" value={validityForm.valid_hours} onChange={(value) => setValidityForm({ ...validityForm, valid_hours: value })} />
                  <Field label="Max Views" type="number" value={validityForm.max_views} onChange={(value) => setValidityForm({ ...validityForm, max_views: value })} />
                </div>
                <p className="muted smallCopy">Updating days or hours generates a new preview code automatically.</p>
                {notice ? <div className="hintText">{notice}</div> : null}
                <button className="secondaryBtn" disabled={saving} onClick={updateCodeValidity} type="button"><CalendarClock size={16} /> Update Access & Generate Code</button>
              </div>
            ) : null}
            <div className="buttonRow">
              {hasPermission(currentUser, 'publish_project') ? <button className="primaryBtn" disabled={saving} onClick={() => updateStatus('published')} type="button">Publish</button> : null}
              {hasPermission(currentUser, 'delete_project') ? <button className="secondaryBtn danger" onClick={removeProject} type="button"><Trash2 size={16} /> Delete</button> : null}
            </div>
          </div>

          <MediaManager project={project} onChange={setProject} onSelectMedia={setActiveMediaId} canEdit={hasPermission(currentUser, 'edit_project')} />
          <MeasurementManager
            project={project}
            onChange={setProject}
            pickedPoint={measurementPlacement.point}
            isPicking={measurementPlacement.active}
            canEdit={hasPermission(currentUser, 'edit_project')}
            activeMedia={activeMedia}
            onStartPicking={() => setMeasurementPlacement((current) => ({ ...current, active: true }))}
            onCancelPicking={() => setMeasurementPlacement((current) => ({ ...current, active: false }))}
            onClearPicked={() => setMeasurementPlacement({ active: false, point: null })}
          />
          <FixtureManager project={project} onChange={setProject} canEdit={hasPermission(currentUser, 'edit_project')} />
          <CodeUsageLog project={project} />
          <ViewerLog views={project.views || []} />
          <FeedbackList feedback={project.feedback || []} />
        </aside>
      </section>
    </main>
  );
}

function MediaManager({ project, onChange, onSelectMedia, canEdit }) {
  const [mediaType, setMediaType] = useState('site_photo');
  const [files, setFiles] = useState([]);
  const [labels, setLabels] = useState([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!canEdit) return;
    setError('');
    if (!files.length) {
      setError('Choose at least one file.');
      return;
    }
    const data = new FormData();
    data.append('media_type', mediaType);
    data.append('label', label);
    files.forEach((file, index) => {
      data.append('files', file);
      data.append('labels', labels[index] || label || file.name);
    });
    try {
      setLoading(true);
      const response = await apiFetch(`/api/admin/projects/${project.id}/media`, { method: 'POST', body: data, headers: {} });
      onChange(response.project);
      const last = response.project.media?.[response.project.media.length - 1];
      if (last) onSelectMedia(last.id);
      setFiles([]);
      setLabels([]);
      setLabel('');
    } catch (err) {
      setError(err.message || 'Could not upload media.');
    } finally {
      setLoading(false);
    }
  }

  async function remove(id) {
    const response = await apiFetch(`/api/admin/media/${id}`, { method: 'DELETE' });
    onChange(response.project);
    if (response.project.media?.[0]) onSelectMedia(response.project.media[0].id);
  }

  const accept = mediaType === 'diagram_pdf' ? 'application/pdf' : 'image/*';

  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Project Media</h2><Layers size={18} /></div>
      <p className="muted smallCopy">Display order is fixed for clients: site photos first, Ricky images second, 2D diagrams third, and panoramic 3D views last.</p>
      {canEdit ? (
        <form className="stack" onSubmit={submit}>
          <div className="twoCol">
            <label className="field"><span>Media Type</span><select value={mediaType} onChange={(e) => setMediaType(e.target.value)}><option value="site_photo">Site Photo</option><option value="ricky_image">Ricky Image</option><option value="diagram_pdf">2D Diagram PDF</option><option value="panorama">Panoramic 3D View</option></select></label>
            <Field label="Default Label" value={label} onChange={setLabel} />
          </div>
          <NamedFileUpload label="Upload Files" accept={accept} multiple files={files} labels={labels} onChange={setFiles} onLabelsChange={setLabels} namePlaceholder="Name this file for client preview" />
          {error ? <div className="errorText">{error}</div> : null}
          <button className="primaryBtn" disabled={loading} type="submit"><Upload size={16} /> {loading ? 'Uploading...' : 'Add Media'}</button>
        </form>
      ) : <p className="muted">You do not have permission to edit media.</p>}
      <ItemList
        items={project.media || []}
        empty="No media uploaded."
        render={(item) => (
          <>
            <div>
              <strong>{item.label || mediaLabel(item.type)}</strong>
              <span>{mediaLabel(item.type)} • {item.original_filename || item.filename}</span>
            </div>
            <div className="miniActions">
              <button className="tinyBtn" onClick={() => onSelectMedia(item.id)} type="button">View</button>
              {canEdit ? <button className="tinyDanger" onClick={() => remove(item.id)} type="button"><Trash2 size={14} /></button> : null}
            </div>
          </>
        )}
      />
    </div>
  );
}

function MeasurementManager({ project, onChange, pickedPoint, isPicking, canEdit, activeMedia, onStartPicking, onCancelPicking, onClearPicked }) {
  const defaultUnit = project.unit || 'ft';
  const emptyForm = { side_name: '', width: '', height: '', depth: '', unit: defaultUnit, yaw: '', pitch: '', remarks: '' };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm((current) => ({ ...current, unit: current.unit || defaultUnit })); }, [defaultUnit]);
  useEffect(() => {
    if (!pickedPoint) return;
    setForm((current) => ({ ...current, yaw: String(pickedPoint.yaw), pitch: String(pickedPoint.pitch) }));
    setSuccess('Position selected. Add the size and save the measurement.');
  }, [pickedPoint]);

  function applyPreset(label, width = '', height = '', depth = '', remarks = '') {
    setForm((current) => ({ ...current, side_name: label, width: width || current.width, height: height || current.height || project.shop_height || '', depth: depth || current.depth, remarks: remarks || current.remarks }));
  }

  function editMeasurement(item) {
    setEditingId(item.id);
    setForm({ side_name: item.side_name || '', width: item.width || '', height: item.height || '', depth: item.depth || '', unit: item.unit || defaultUnit, yaw: item.yaw ?? '', pitch: item.pitch ?? '', remarks: item.remarks || '' });
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
    if (!canEdit) return;
    setError('');
    setSuccess('');
    const payload = { side_name: form.side_name.trim(), width: Number(form.width), height: Number(form.height), depth: form.depth === '' ? 0 : Number(form.depth), unit: form.unit || defaultUnit, yaw: Number(form.yaw), pitch: Number(form.pitch), remarks: form.remarks || null };
    if (!payload.side_name) return setError('Enter a label name.');
    if (!payload.width || !payload.height || payload.width <= 0 || payload.height <= 0) return setError('Enter width and height values greater than 0.');
    if (Number.isNaN(payload.depth) || payload.depth < 0) return setError('Enter a valid depth value.');
    if (Number.isNaN(payload.yaw) || Number.isNaN(payload.pitch)) return setError('Click Place / Reposition, then click inside a panoramic 3D view.');
    try {
      setSaving(true);
      const url = editingId ? `/api/admin/measurements/${editingId}` : `/api/admin/projects/${project.id}/measurements`;
      const data = await apiFetch(url, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      onChange(data.project);
      setEditingId(null);
      setForm({ ...emptyForm, unit: payload.unit });
      onClearPicked?.();
      setSuccess(editingId ? 'Measurement updated.' : 'Measurement added.');
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
    { label: 'Door', width: '', height: '', depth: '' },
    { label: 'Shelf Area', width: '', height: '', depth: '' },
    { label: 'Ceiling Height', width: project.shop_width || '', height: project.shop_height || '' },
  ];

  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Dynamic Measurements</h2><Ruler size={18} /></div>
      <p className="muted smallCopy">Add width, height and depth anywhere inside a panoramic 3D view.</p>
      {!canEdit ? <p className="muted">You do not have permission to edit measurements.</p> : null}
      <div className="quickChips">
        {presets.map((preset) => <button key={preset.label} className="chipBtn" type="button" onClick={() => applyPreset(preset.label, preset.width, preset.height, preset.depth)}>{preset.label}</button>)}
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="twoCol"><Field label="Measurement Label" value={form.side_name} onChange={(value) => setForm({ ...form, side_name: value })} required /><label className="field"><span>Unit</span><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option>ft</option><option>m</option><option>cm</option><option>inch</option></select></label></div>
        <div className="threeCol"><Field label="Width / Length" type="number" value={form.width} onChange={(value) => setForm({ ...form, width: value })} required /><Field label="Height" type="number" value={form.height} onChange={(value) => setForm({ ...form, height: value })} required /><Field label="Depth" type="number" value={form.depth} onChange={(value) => setForm({ ...form, depth: value })} /></div>
        <div className="placementBox"><div><strong>{form.yaw !== '' && form.pitch !== '' ? 'Position selected' : 'Position not selected'}</strong><span>{form.yaw !== '' && form.pitch !== '' ? `Yaw ${form.yaw}°, Pitch ${form.pitch}°` : activeMedia?.type === 'panorama' ? 'Click the button, then click the panorama preview.' : 'Select a panoramic 3D view first.'}</span></div><div className="placementActions"><button className="secondaryBtn" type="button" disabled={!canEdit || activeMedia?.type !== 'panorama'} onClick={isPicking ? onCancelPicking : onStartPicking}>{isPicking ? 'Cancel Click Mode' : 'Place / Reposition'}</button></div></div>
        {isPicking ? <div className="activePickNotice">Now click once on the viewer where this measurement label should appear.</div> : null}
        <textarea placeholder="Optional remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        {error ? <div className="errorText">{error}</div> : null}
        {success ? <div className="hintText">{success}</div> : null}
        <div className="buttonRow"><button className="primaryBtn" disabled={saving || !canEdit} type="submit"><Plus size={16} /> {saving ? 'Saving...' : editingId ? 'Update Measurement' : 'Add Measurement'}</button>{editingId ? <button className="secondaryBtn" type="button" onClick={resetForm}>Cancel Edit</button> : null}</div>
      </form>
      <ItemList items={project.measurements} empty="No measurements added yet." render={(item) => <><div><strong>{item.side_name}</strong><span>{dimensionsText(item, project.unit)}</span><small>Position: yaw {item.yaw}°, pitch {item.pitch}°</small></div><div className="miniActions">{canEdit ? <button className="tinyBtn" onClick={() => editMeasurement(item)} type="button">Edit</button> : null}{canEdit ? <button className="tinyDanger" onClick={() => remove(item.id)} type="button"><Trash2 size={14} /></button> : null}</div></>} />
    </div>
  );
}

function FixtureManager({ project, onChange, canEdit }) {
  const [form, setForm] = useState({ fixture_name: '', fixture_type: 'Wall Display', width: '', height: '', depth: '', unit: project.unit || 'ft', yaw: 0, pitch: -5, scale: 1, color: '#CF1E01', remarks: '' });
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (!canEdit) return;
    setError('');
    try {
      const payload = { ...form, width: form.width ? Number(form.width) : null, height: form.height ? Number(form.height) : null, depth: form.depth ? Number(form.depth) : null, yaw: Number(form.yaw), pitch: Number(form.pitch), scale: Number(form.scale) };
      const data = await apiFetch(`/api/admin/projects/${project.id}/fixtures`, { method: 'POST', body: JSON.stringify(payload) });
      onChange(data.project);
      setForm({ ...form, fixture_name: '', width: '', height: '', depth: '', remarks: '' });
    } catch (err) { setError(err.message || 'Could not add fixture.'); }
  }
  async function remove(id) { const data = await apiFetch(`/api/admin/fixtures/${id}`, { method: 'DELETE' }); onChange(data.project); }
  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Fixture Overlay</h2><Box size={18} /></div>
      {!canEdit ? <p className="muted">You do not have permission to edit fixtures.</p> : null}
      <form className="stack" onSubmit={submit}>
        <div className="twoCol"><Field label="Fixture Name" value={form.fixture_name} onChange={(value) => setForm({ ...form, fixture_name: value })} required /><label className="field"><span>Type</span><select value={form.fixture_type} onChange={(e) => setForm({ ...form, fixture_type: e.target.value })}><option>Wall Display</option><option>Gondola Rack</option><option>Counter Display</option><option>Island Display</option><option>Branding Panel</option></select></label></div>
        <div className="fourCol"><Field label="Width" type="number" value={form.width} onChange={(value) => setForm({ ...form, width: value })} /><Field label="Height" type="number" value={form.height} onChange={(value) => setForm({ ...form, height: value })} /><Field label="Depth" type="number" value={form.depth} onChange={(value) => setForm({ ...form, depth: value })} /><Field label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} /></div>
        <Slider label={`Yaw ${form.yaw}°`} value={form.yaw} min="-180" max="180" onChange={(value) => setForm({ ...form, yaw: value })} />
        <Slider label={`Pitch ${form.pitch}°`} value={form.pitch} min="-70" max="70" onChange={(value) => setForm({ ...form, pitch: value })} />
        <Slider label={`Scale ${form.scale}`} value={form.scale} min="0.5" max="2" step="0.1" onChange={(value) => setForm({ ...form, scale: value })} />
        <label className="field"><span>Fixture Color</span><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
        <textarea placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        {error ? <div className="errorText">{error}</div> : null}
        <button className="primaryBtn" disabled={!canEdit} type="submit"><Plus size={16} /> Add Fixture</button>
      </form>
      <ItemList items={project.fixtures} empty="No fixtures added." render={(item) => <><div><strong>{item.fixture_name}</strong><span>{item.fixture_type || 'Fixture'} • {dimensionsText(item, project.unit)}</span></div>{canEdit ? <button className="tinyDanger" onClick={() => remove(item.id)} type="button"><Trash2 size={14} /></button> : null}</>} />
    </div>
  );
}

function CodeUsageLog({ project }) {
  const rows = project.code_history || [];
  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Code Usage</h2><CalendarClock size={18} /></div>
      <ItemList
        items={rows}
        empty="No code history yet."
        render={(item) => (
          <>
            <div>
              <strong>{item.code}</strong>
              <span>{item.viewer_count || 0} views • Max {item.max_views ? item.max_views : 'Unlimited'}</span>
              <small>{item.replaced_at ? `Replaced on ${formatDate(item.replaced_at)}` : `Valid until ${formatDate(item.valid_until)}`}</small>
            </div>
          </>
        )}
      />
    </div>
  );
}

function ViewerLog({ views }) {
  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Viewer Log</h2><Eye size={18} /></div>
      <ItemList items={views} empty="No client views yet." render={(item) => <><div><strong>{item.name}</strong><span>{item.company_name} • Code {item.code}</span><small>{formatDate(item.viewed_at)}</small></div></>} />
    </div>
  );
}

function FeedbackList({ feedback }) {
  return (
    <div className="panelCard compactCard">
      <div className="sectionTitle"><h2>Client Feedback</h2><Send size={18} /></div>
      <ItemList items={feedback} empty="No feedback submitted yet." render={(item) => <><strong>{item.name || 'Client'}</strong><span>{item.company_name ? `${item.company_name} • ` : ''}{item.message}</span><small>{formatDate(item.created_at)}</small></>} />
    </div>
  );
}

function EmployeeManager() {
  const defaultPermissions = {
    view_project: true,
    create_project: true,
    edit_project: true,
    delete_project: false,
    publish_project: false,
    manage_employees: false,
  };
  const blankForm = {
    name: '',
    employee_id: '',
    email: '',
    password: '',
    permissions: defaultPermissions,
    is_active: true,
  };
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(blankForm);
  const [editingUser, setEditingUser] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const permissionLabels = [
    ['view_project', 'View Access'],
    ['create_project', 'Create'],
    ['edit_project', 'Edit'],
    ['delete_project', 'Delete'],
    ['publish_project', 'Publish'],
    ['manage_employees', 'Employees'],
  ];

  async function loadUsers() {
    try {
      setError('');
      const data = await apiFetch('/api/admin/users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message || 'Could not load employees.');
    }
  }

  useEffect(() => { loadUsers(); }, []);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePermission(key) {
    setForm((current) => ({
      ...current,
      permissions: { ...current.permissions, [key]: !current.permissions[key] },
    }));
  }

  function resetEmployeeForm() {
    setEditingUser(null);
    setForm(blankForm);
    setError('');
  }

  function startEdit(user) {
    if (user.role === 'admin') return;
    setEditingUser(user);
    setNotice('');
    setError('');
    setForm({
      name: user.name || '',
      employee_id: user.employee_id || '',
      email: user.email || '',
      password: '',
      permissions: { ...defaultPermissions, ...(user.permissions || {}) },
      is_active: Boolean(user.is_active),
    });
    setTimeout(() => document.querySelector('.employeeForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function submitEmployee(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      setLoading(true);
      const payload = {
        ...form,
        name: form.name.trim(),
        employee_id: form.employee_id.trim(),
        email: form.email.trim(),
      };
      if (editingUser && !payload.password) delete payload.password;
      const path = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
      const method = editingUser ? 'PUT' : 'POST';
      await apiFetch(path, { method, body: JSON.stringify(payload) });
      setNotice(editingUser ? 'Employee updated successfully.' : 'Employee login created successfully.');
      resetEmployeeForm();
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Could not save employee.');
    } finally {
      setLoading(false);
    }
  }

  async function updatePermission(user, key) {
    if (user.role === 'admin') return;
    setError('');
    setNotice('');
    try {
      const permissions = { ...defaultPermissions, ...(user.permissions || {}), [key]: !Boolean(user.permissions?.[key]) };
      await apiFetch(`/api/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ permissions }) });
      setNotice(`${user.name}'s permission updated.`);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Could not update permission.');
    }
  }

  async function toggleActive(user) {
    if (user.role === 'admin') return;
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !user.is_active }) });
      setNotice(`${user.name} ${user.is_active ? 'disabled' : 'enabled'} successfully.`);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Could not change employee status.');
    }
  }

  async function remove(user) {
    if (user.role === 'admin') return;
    if (!window.confirm(`Delete ${user.name}? This employee login will be removed permanently.`)) return;
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (editingUser?.id === user.id) resetEmployeeForm();
      setNotice(`${user.name} deleted successfully.`);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Could not delete employee.');
    }
  }

  const employeeCount = users.filter((item) => item.role !== 'admin').length;
  const activeCount = users.filter((item) => item.role !== 'admin' && item.is_active).length;

  return (
    <section className="panelCard employeePanel cleanEmployeePanel">
      <div className="sectionTitle employeeTitle">
        <div>
          <h2>Employee Management</h2>
          <p className="muted">Create, edit, disable, delete, and control employee access permissions.</p>
        </div>
        <Users size={20} />
      </div>

      <div className="employeeStatsGrid">
        <Metric label="Employees" value={employeeCount} />
        <Metric label="Active Logins" value={activeCount} />
        <Metric label="Admin Account" value="1" />
      </div>

      <form className="stack employeeForm cleanEmployeeForm" onSubmit={submitEmployee}>
        <div className="formSubHeader employeeFormHeader">
          <div>
            <strong>{editingUser ? `Edit Employee: ${editingUser.name}` : 'Create Employee Login'}</strong>
            <small>{editingUser ? 'Update details, login status, or permissions.' : 'Add a new employee and assign permissions.'}</small>
          </div>
          {editingUser ? <button className="tinyBtn" type="button" onClick={resetEmployeeForm}>Cancel Edit</button> : null}
        </div>

        <div className="employeeFormGrid">
          <Field label="Employee Name" value={form.name} onChange={(value) => updateForm('name', value)} required />
          <Field label="Employee ID" value={form.employee_id} onChange={(value) => updateForm('employee_id', value)} required />
          <Field label="Email" value={form.email} onChange={(value) => updateForm('email', value)} required />
          <Field label={editingUser ? 'New Password (optional)' : 'Password'} type="password" value={form.password} onChange={(value) => updateForm('password', value)} required={!editingUser} />
        </div>

        <div className="employeeControlRow">
          <label className="checkPill activeToggle"><input type="checkbox" checked={form.is_active} onChange={() => updateForm('is_active', !form.is_active)} /> Login Active</label>
        </div>

        <div className="permissionMatrix">
          {permissionLabels.map(([key, label]) => (
            <label key={key} className="permissionCard">
              <input type="checkbox" checked={Boolean(form.permissions[key])} onChange={() => togglePermission(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {error ? <div className="errorText">{error}</div> : null}
        {notice ? <div className="successText">{notice}</div> : null}

        <div className="employeeSubmitRow">
          <button className="primaryBtn" disabled={loading} type="submit"><Plus size={16} /> {loading ? 'Saving...' : editingUser ? 'Update Employee' : 'Create Employee'}</button>
          {editingUser ? <button className="secondaryBtn" type="button" onClick={resetEmployeeForm}>Clear</button> : null}
        </div>
      </form>

      <div className="employeeDirectory">
        <div className="employeeDirectoryHeader">
          <strong>Employee Directory</strong>
          <span>{users.length} accounts</span>
        </div>
        <div className="employeeList cleanEmployeeList">
          {users.map((user) => {
            const isAdmin = user.role === 'admin';
            return (
              <div key={user.id} className={isAdmin ? 'employeeCard adminEmployeeRow' : 'employeeCard'}>
                <div className="employeeIdentity">
                  <strong>{user.name}</strong>
                  <span>{user.employee_id} • {user.email}</span>
                  <small>{isAdmin ? 'Admin account' : user.is_active ? 'Active employee login' : 'Disabled employee login'}</small>
                </div>

                <div className="permissionMatrix compactPermissionMatrix">
                  {permissionLabels.map(([key, label]) => (
                    <label key={key} className={isAdmin ? 'permissionCard locked' : 'permissionCard'}>
                      <input type="checkbox" disabled={isAdmin} checked={Boolean(user.permissions?.[key])} onChange={() => updatePermission(user, key)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <div className="employeeActions cleanEmployeeActions">
                  {isAdmin ? <span className="adminLock">Protected</span> : <button className="tinyBtn" onClick={() => startEdit(user)} type="button">Edit</button>}
                  {!isAdmin ? <button className="tinyBtn" onClick={() => toggleActive(user)} type="button">{user.is_active ? 'Disable' : 'Enable'}</button> : null}
                  {!isAdmin ? <button className="tinyDanger employeeDeleteBtn" onClick={() => remove(user)} type="button"><Trash2 size={14} /> Delete</button> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function InfoCard({ title, icon, children }) { return <div className="panelCard compactCard"><div className="sectionTitle"><h2>{title}</h2>{icon}</div>{children}</div>; }
function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function ItemList({ items = [], empty, render }) { if (!items.length) return <div className="emptyState smallEmpty">{empty}</div>; return <div className="itemList">{items.map((item, index) => <div className="miniItem" key={item.id || index}>{render(item)}</div>)}</div>; }
function Field({ label, value, onChange, type = 'text', required = false }) { return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} /></label>; }
function Slider({ label, value, onChange, min, max, step = '1' }) { return <label className="field sliderField"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function syncLabelsForFiles(files, currentLabels = []) {
  return files.map((file, index) => currentLabels[index] || file.name || `Media ${index + 1}`);
}

function NamedFileUpload({ label, accept, multiple = false, files = [], labels = [], onChange, onLabelsChange, required = false, namePlaceholder = 'Name this file' }) {
  function handleFiles(event) {
    const nextFiles = Array.from(event.target.files || []);
    onChange(nextFiles);
    onLabelsChange(syncLabelsForFiles(nextFiles, labels));
  }

  function updateLabel(index, value) {
    const nextLabels = syncLabelsForFiles(files, labels);
    nextLabels[index] = value;
    onLabelsChange(nextLabels);
  }

  return (
    <div className="namedUploadGroup">
      <label className="uploadBox">
        <Upload size={18} />
        <span>{files.length ? `${files.length} selected: ${files.map((file) => file.name).join(', ')}` : label}</span>
        <input type="file" accept={accept} multiple={multiple} required={required} onChange={handleFiles} />
      </label>
      {files.length ? (
        <div className="fileNameList">
          {files.map((file, index) => (
            <label className="field fileNameField" key={`${file.name}-${index}`}>
              <span>Name for {file.name}</span>
              <input value={labels[index] || ''} placeholder={namePlaceholder} onChange={(event) => updateLabel(index, event.target.value)} />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileUpload({ label, accept, multiple = false, files = [], onChange, required = false }) { return <label className="uploadBox"><Upload size={18} /><span>{files.length ? `${files.length} selected: ${files.map((file) => file.name).join(', ')}` : label}</span><input type="file" accept={accept} multiple={multiple} required={required} onChange={(e) => onChange(Array.from(e.target.files || []))} /></label>; }

export default App;
