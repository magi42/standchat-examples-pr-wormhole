// Procedural gravitational lens. No textures, models, or rendering dependencies.
const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
uniform vec2 resolution; uniform float time;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return v;}
vec3 sky(vec2 p){
 float band=exp(-pow((p.y+p.x*.33-.13)*3.8,2.));
 float clouds=fbm(p*5.+vec2(8,2));
 vec3 col=vec3(.012,.023,.035)+vec3(.115,.14,.16)*band*pow(clouds,2.);
 col+=vec3(.085,.055,.032)*pow(fbm(p*9.+4.),3.)*band;
 for(int i=0;i<3;i++){
 float scale=110.+float(i)*85.;vec2 q=p*scale;vec2 id=floor(q);vec2 f=fract(q)-.5;
 vec2 offset=vec2(hash(id+3.),hash(id+7.))-.5;
 float star=pow(max(0.,1.-length(f-offset*.65)*3.5),9.);
 float h=hash(id+float(i)*100.);star*=step(.965,h);
 col+=star*mix(vec3(.58,.72,1.),vec3(1.,.88,.67),hash(id+17.))*(.8+float(i)*.3);
 }return col;
}
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 vec2 p=(gl_FragCoord.xy-resolution*vec2(.55,.57))/resolution.y;
 float r=length(p), radius=.205;float a=atan(p.y,p.x);float d=r/radius;
 vec2 drift=vec2(time*.0015,time*.0004);
 vec2 warped=p;
 // Outside the throat, background stars bend tangentially toward the Einstein ring.
 if(d>1.){float bend=.027/max(r,.1);warped=p*(1.-bend/r);}
 vec3 col=sky(warped+drift);
 if(d<1.){
 float z=sqrt(max(0.,1.-d*d));float angle=a+.12*sin(time*.06)+.4*z;
 vec2 other=vec2(cos(angle),sin(angle))*(asin(clamp(d,0.,1.))*.4);
 col=sky(other*2.+vec2(5.4,1.8)-drift*.6)*(.65+.9*z);
 float cloud=fbm(other*17.+vec2(time*.008,7.));
 col+=vec3(.12,.22,.25)*cloud*pow(z,1.4);
 col*=.67+.33*z;
 }
 float ring=exp(-abs(d-1.)*130.);
 float halo=exp(-abs(d-1.)*16.);
 float arcs=.55+.45*fbm(vec2(a*4.,d*55.-time*.07));
 col+=vec3(.82,.85,.76)*ring*(.55+arcs);
 col+=vec3(.26,.35,.37)*halo*.35;
 col+=vec3(.32,.23,.13)*exp(-abs(d-1.045)*50.)*arcs*.55;
 // A compressed and lensed strip of the distant galaxy, not an accretion disk.
 float filament=exp(-pow((r-radius*(1.04+.024*sin(a*5.+time*.04)))*260.,2.));
 col+=vec3(.29,.32,.29)*filament*pow(.5+.5*sin(a*3.+1.),3.);
 col*=1.-.4*pow(length(uv-.5),1.4);
 col+=hash(gl_FragCoord.xy)*.012;
 gl_FragColor=vec4(pow(col,vec3(.85)),1.);
}`;

export class SpaceScene {
  constructor(canvas) {
    this.canvas = canvas; this.time = 0; this.paused = false;
    try {
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
      if (!gl) throw Error('WebGL unavailable');
      this.gl = gl;
      const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      this.resolution = gl.getUniformLocation(program, 'resolution'); this.clock = gl.getUniformLocation(program, 'time');
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.gl = null; document.body.classList.add('no-webgl'); });
      canvas.addEventListener('webglcontextrestored', () => { this.gl = null; document.body.classList.add('no-webgl'); });
    } catch { document.body.classList.add('no-webgl'); }
    this.resize(); this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    // Cap fragment cost on Retina/mobile; the starfield is intentionally cinematic.
    const scale = Math.min(devicePixelRatio || 1, 1.25, 1500 / Math.max(r.width, 1));
    this.canvas.width = Math.max(1, Math.round(r.width * scale)); this.canvas.height = Math.max(1, Math.round(r.height * scale)); this.draw(0);
  }
  center() { const r = this.canvas.getBoundingClientRect(); return { x: r.left + r.width * .55, y: r.top + r.height * .43, radius: r.height * .205 }; }
  draw(dt) {
    if (!this.paused) this.time += dt;
    const gl = this.gl; if (!gl) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.uniform2f(this.resolution, this.canvas.width, this.canvas.height); gl.uniform1f(this.clock, this.time); gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

export class Transmissions {
  constructor(canvas, scene, onStatus) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.scene = scene; this.onStatus = onStatus; this.flights = []; this.paused = false; this.resize(); addEventListener('resize', () => this.resize()); }
  resize() { this.width = innerWidth; this.height = innerHeight; const dpr = Math.min(devicePixelRatio || 1, 2); this.canvas.width = this.width * dpr; this.canvas.height = this.height * dpr; this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); }
  fly(text, incoming = false) {
    if (this.paused || !this.ctx || document.hidden) return Promise.resolve();
    // Long messages retain their complete accessible transcript; the flight is a visual excerpt.
    const letters = Array.from(text.replace(/\s+/g, ' ')).slice(0, 160);
    return new Promise(resolve => { this.flights.push({ letters, incoming, elapsed: 0, duration: 3.2 + Math.min(letters.length * .012, 1.6), resolve }); this.onStatus(incoming ? 'INCOMING TRANSMISSION' : 'TRANSMITTING TO HORIZON'); });
  }
  finish() { for (const flight of this.flights) flight.resolve(); this.flights = []; this.ctx?.clearRect(0,0,this.width,this.height); this.onStatus('TRANSMITTER READY'); }
  draw(dt) {
    const ctx = this.ctx; if (!ctx) return; ctx.clearRect(0,0,this.width,this.height);
    const center = this.scene.center(); const dock = document.querySelector('#compose').getBoundingClientRect();
    const startX = dock.left + dock.width * .45, startY = dock.top;
    for (const flight of this.flights) {
      flight.elapsed += dt; const color = flight.incoming ? '#b5f0f1' : '#ffbd7b';
      for (let i=0; i<flight.letters.length; i++) {
        const t = (flight.elapsed - i*.009) / 3.2; if (t<0 || t>1) continue;
        const p = flight.incoming ? 1-t : t;
        const approach = Math.min(p/.65, 1); const ease = 1-Math.pow(1-approach, 2);
        const spiral = Math.max(0,(p-.45)/.55);
        const spread = (i%32-15.5)*13; const row = Math.floor(i/32)*21;
        let x = startX + spread*(1-ease) + (center.x-startX)*ease;
        let y = startY + row*(1-ease) + (center.y-startY)*ease;
        const radius = Math.sin(spiral*Math.PI)*center.radius*.65;
        const angle = spiral*Math.PI*3.8 + i*.07;
        x += Math.cos(angle)*radius; y += Math.sin(angle)*radius*.72;
        const scale = .14+(1-p)*1.1;
        const alpha = Math.min(1,t*9,(1-t)*12);
        ctx.save();ctx.translate(x,y);ctx.rotate(spiral*4);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
        ctx.font='500 18px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=9;ctx.fillText(flight.letters[i],0,0);ctx.restore();
      }
      if (flight.elapsed >= flight.duration) flight.resolve();
    }
    const had = this.flights.length; this.flights = this.flights.filter(f=>f.elapsed<f.duration);
    if (had && !this.flights.length) this.onStatus('TRANSMITTER READY');
  }
}
