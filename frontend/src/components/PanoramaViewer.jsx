import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function sphericalPosition(yawDeg, pitchDeg, radius = 420) {
  const yaw = THREE.MathUtils.degToRad(Number(yawDeg || 0));
  const pitch = THREE.MathUtils.degToRad(Number(pitchDeg || 0));
  return new THREE.Vector3(
    radius * Math.sin(yaw) * Math.cos(pitch),
    radius * Math.sin(pitch),
    radius * Math.cos(yaw) * Math.cos(pitch)
  );
}

function directionToYawPitch(direction) {
  const dir = direction.clone().normalize();
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
  const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
  return {
    yaw: Math.round(yaw * 10) / 10,
    pitch: Math.round(pitch * 10) / 10,
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.slice(0, 3).forEach((entry, index) => {
    ctx.fillText(entry, x, startY + index * lineHeight);
  });
}

function makeLabelTexture({ title, subtitle, type = 'measurement', color = '#101828' }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = type === 'fixture' ? 620 : 320;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isFixture = type === 'fixture';
  const background = isFixture ? color : '#101828';
  const border = isFixture ? '#FEFEFF' : '#CF1E01';

  ctx.fillStyle = background;
  ctx.globalAlpha = isFixture ? 0.88 : 0.86;
  roundedRect(ctx, 28, 28, canvas.width - 56, canvas.height - 56, 48);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.lineWidth = 10;
  ctx.strokeStyle = border;
  roundedRect(ctx, 28, 28, canvas.width - 56, canvas.height - 56, 48);
  ctx.stroke();

  if (isFixture) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundedRect(ctx, 170, 150, canvas.width - 340, 250, 36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 8;
    roundedRect(ctx, 170, 150, canvas.width - 340, 250, 36);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 5;
    for (let i = 1; i <= 3; i += 1) {
      const y = 150 + i * 62;
      ctx.beginPath();
      ctx.moveTo(190, y);
      ctx.lineTo(canvas.width - 190, y);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#FEFEFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = isFixture ? 'bold 66px Inter, Arial, sans-serif' : 'bold 58px Inter, Arial, sans-serif';
  wrapText(ctx, title, canvas.width / 2, isFixture ? 92 : 110, canvas.width - 120, 68);

  ctx.fillStyle = isFixture ? '#FEFEFF' : '#F7F7F8';
  ctx.font = isFixture ? '44px Inter, Arial, sans-serif' : '48px Inter, Arial, sans-serif';
  wrapText(ctx, subtitle, canvas.width / 2, isFixture ? 470 : 218, canvas.width - 120, 52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeSelectionTexture(label = 'Selected Position') {
  const canvas = document.createElement('canvas');
  canvas.width = 820;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(207, 30, 1, 0.92)';
  roundedRect(ctx, 28, 28, canvas.width - 56, canvas.height - 56, 42);
  ctx.fill();

  ctx.strokeStyle = '#FEFEFF';
  ctx.lineWidth = 8;
  roundedRect(ctx, 28, 28, canvas.width - 56, canvas.height - 56, 42);
  ctx.stroke();

  ctx.fillStyle = '#FEFEFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 54px Inter, Arial, sans-serif';
  wrapText(ctx, label, canvas.width / 2, 110, canvas.width - 120, 60);

  ctx.font = '40px Inter, Arial, sans-serif';
  ctx.fillText('Save from the right panel', canvas.width / 2, 205);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export default function PanoramaViewer({
  imageUrl,
  measurements = [],
  fixtures = [],
  height = 620,
  placementMode = false,
  selectionPoint = null,
  selectionLabel = 'New Measurement',
  onPickPoint,
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const overlayGroupRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const requestRef = useRef(null);
  const pointerStartRef = useRef(null);
  const placementModeRef = useRef(placementMode);
  const onPickPointRef = useRef(onPickPoint);

  const normalizedImageUrl = useMemo(() => imageUrl, [imageUrl]);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

  useEffect(() => {
    if (!mountRef.current || !normalizedImageUrl) return undefined;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 1200);
    camera.position.set(0, 0, 0.1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    rendererRef.current = renderer;
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(500, 96, 64);
    geometry.scale(-1, 1, 1);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      normalizedImageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
      },
      undefined,
      () => {
        const material = new THREE.MeshBasicMaterial({ color: '#e5e7eb' });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
      }
    );

    const overlayGroup = new THREE.Group();
    overlayGroupRef.current = overlayGroup;
    scene.add(overlayGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.rotateSpeed = -0.34;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 0.1;
    controls.maxDistance = 5;
    controlsRef.current = controls;

    const handlePointerDown = (event) => {
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerUp = (event) => {
      if (!placementModeRef.current || !cameraRef.current || !rendererRef.current) return;
      const start = pointerStartRef.current;
      if (!start) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > 8) return;

      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);
      const point = directionToYawPitch(raycaster.ray.direction);
      onPickPointRef.current?.(point);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = mountRef.current.clientWidth;
      const containerHeight = mountRef.current.clientHeight;
      cameraRef.current.aspect = width / containerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, containerHeight);
    };

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      requestRef.current = window.requestAnimationFrame(animate);
    };
    animate();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      if (requestRef.current) window.cancelAnimationFrame(requestRef.current);
      controls.dispose();
      geometry.dispose();
      renderer.dispose();
      mount.innerHTML = '';
    };
  }, [normalizedImageUrl]);

  useEffect(() => {
    const group = overlayGroupRef.current;
    if (!group) return;

    while (group.children.length) {
      const child = group.children.pop();
      if (child?.material?.map) child.material.map.dispose();
      if (child?.material) child.material.dispose();
    }

    measurements.forEach((item) => {
      const subtitle = `${Number(item.width || 0)} ${item.unit || 'ft'} W x ${Number(item.height || 0)} ${item.unit || 'ft'} H`;
      const texture = makeLabelTexture({ title: item.side_name, subtitle, type: 'measurement' });
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(sphericalPosition(item.yaw, item.pitch, 410));
      sprite.scale.set(78, 25, 1);
      group.add(sprite);
    });

    fixtures.forEach((item) => {
      const dims = [
        item.width ? `${item.width}${item.unit || 'ft'} W` : null,
        item.height ? `${item.height}${item.unit || 'ft'} H` : null,
        item.depth ? `${item.depth}${item.unit || 'ft'} D` : null,
      ].filter(Boolean).join(' x ');
      const subtitle = dims || item.fixture_type || 'Fixture preview';
      const texture = makeLabelTexture({
        title: item.fixture_name,
        subtitle,
        type: 'fixture',
        color: item.color || '#CF1E01',
      });
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(sphericalPosition(item.yaw, item.pitch, 380));
      const scale = Number(item.scale || 1);
      sprite.scale.set(86 * scale, 52 * scale, 1);
      group.add(sprite);
    });

    if (selectionPoint) {
      const texture = makeSelectionTexture(selectionLabel);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(sphericalPosition(selectionPoint.yaw, selectionPoint.pitch, 398));
      sprite.scale.set(72, 26, 1);
      group.add(sprite);
    }
  }, [measurements, fixtures, selectionPoint, selectionLabel]);

  return (
    <div className={`viewerShell ${placementMode ? 'placementActive' : ''}`} style={{ height }}>
      <div className="viewerCanvas" ref={mountRef} />
      {placementMode ? (
        <div className="placementBanner">Click once anywhere to place this measurement</div>
      ) : null}
      <div className="viewerHint">
        {placementMode ? 'Move the view, then click the exact spot for the measurement label' : 'Drag to look around • Scroll to zoom • Measurement labels are read-only for clients'}
      </div>
    </div>
  );
}
