import { useEffect, useRef } from 'react';

export default function DVChart({ snapshot }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot?.satellites) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const w = W, h = H;

    const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
    const chartW = w - PAD.left - PAD.right;
    const chartH = h - PAD.top  - PAD.bottom;

    ctx.fillStyle = '#070d17';
    ctx.fillRect(0, 0, w, h);

    // Filter satellites with meaningful ΔV or collision data
    const sats = snapshot.satellites.filter(s => s.total_dv_kmps > 0 || s.collisions_avoided > 0);
    if (sats.length === 0) {
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(200,216,232,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText('No ΔV expenditure yet', w / 2, h / 2);
      return;
    }

    const maxDV = Math.max(...sats.map(s => s.total_dv_kmps)) || 0.01;
    const maxCA = Math.max(...sats.map(s => s.collisions_avoided)) || 1;

    const barW = Math.max(4, chartW / sats.length - 4);

    // Grid lines
    ctx.strokeStyle = 'rgba(32,180,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
    }

    // Y-axis label
    ctx.save();
    ctx.translate(10, PAD.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(200,216,232,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('ΔV (km/s)', 0, 0);
    ctx.restore();

    for (let i = 0; i <= 4; i++) {
      const val = ((maxDV / 4) * i).toFixed(4);
      const y = PAD.top + chartH - (chartH / 4) * i;
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.fillStyle = 'rgba(200,216,232,0.3)';
      ctx.textAlign = 'right';
      ctx.fillText(val, PAD.left - 3, y + 3);
    }

    sats.forEach((sat, i) => {
      const x = PAD.left + i * (barW + 4);
      const dvH = (sat.total_dv_kmps / maxDV) * chartH;
      const y = PAD.top + chartH - dvH;

      // ΔV bar
      const grad = ctx.createLinearGradient(x, y, x, PAD.top + chartH);
      grad.addColorStop(0, '#20b4ffcc');
      grad.addColorStop(1, '#20b4ff22');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, dvH);

      // Collision avoided dots on top
      if (sat.collisions_avoided > 0) {
        const caH = (sat.collisions_avoided / maxCA) * chartH * 0.4;
        ctx.fillStyle = '#00e5a0aa';
        ctx.fillRect(x, y - caH - 2, barW, caH);
        // CA dot
        ctx.beginPath();
        ctx.arc(x + barW / 2, y - caH - 5, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00e5a0';
        ctx.fill();
      }

      // X label — abbreviated
      ctx.font = '7px JetBrains Mono, monospace';
      ctx.fillStyle = 'rgba(200,216,232,0.4)';
      ctx.textAlign = 'center';
      ctx.fillText(sat.id.slice(-4), x + barW / 2, PAD.top + chartH + 12);
    });

    // Legend
    ctx.font = '8px Inter, sans-serif';
    ctx.fillStyle = '#20b4ffaa';
    ctx.fillRect(PAD.left, PAD.top, 8, 8);
    ctx.fillStyle = 'rgba(200,216,232,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('ΔV spent', PAD.left + 11, PAD.top + 8);

    ctx.fillStyle = '#00e5a0aa';
    ctx.fillRect(PAD.left + 65, PAD.top, 8, 8);
    ctx.fillStyle = 'rgba(200,216,232,0.5)';
    ctx.fillText('Collisions avoided', PAD.left + 76, PAD.top + 8);

  }, [snapshot]);

  return (
    <canvas
      ref={canvasRef}
      className="dv-chart-canvas"
      aria-label="Delta-V cost vs collisions avoided chart"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
