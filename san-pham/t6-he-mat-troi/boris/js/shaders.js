/* GLSL for the solar system model.
   Surfaces are baked once on the GPU into equirectangular textures (BAKE_*), then lit at runtime (PLANET_*). */
window.SHADERS = (function () {
  const SNOISE_ALU = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;
  const NOISE_COMMON = /* glsl */`
const mat3 OCT_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm(vec3 p, int oct){
  float a=0.5, s=0.0;
  for(int i=0;i<oct+LOOP_ZERO;i++){ s+=a*snoise(p); p=OCT_ROT*p*2.03+vec3(1.7,9.2,3.1); a*=0.5; }
  return s;
}
float ridged(vec3 p, int oct){
  float a=0.5, s=0.0;
  for(int i=0;i<oct+LOOP_ZERO;i++){ float n=1.0-abs(snoise(p)); s+=a*n*n; p=p*2.07+vec3(3.1,1.3,7.7); a*=0.5; }
  return s;
}
vec3 hash33(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float hash11(float x){ return fract(sin(x*127.1)*43758.5453); }
float sstep(float a, float b, float x){ return smoothstep(0.0, 1.0, (x-a)/(b-a)); }
`;
  const NOISE = SNOISE_ALU + NOISE_COMMON;
  const NOISE_TEX = /* glsl */`
uniform highp sampler3D uNoise;
float snoise(vec3 p){ return texture(uNoise, p * (1.0/32.0)).r; }
` + NOISE_COMMON;

  const BAKE_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const BAKE_HEAD = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uZero;
#define LOOP_ZERO uZero
#define PI 3.141592653589793
${NOISE_TEX}
vec3 dirFromUv(vec2 uv){ float phi = uv.x*2.0*PI; float th = (1.0-uv.y)*PI; return vec3(-cos(phi)*sin(th), cos(th), sin(phi)*sin(th)); }
vec3 dirLL(float lat, float lon){ float la=radians(lat), lo=radians(lon); return vec3(cos(lo)*cos(la), sin(la), -sin(lo)*cos(la)); }
float angDist(vec3 a, vec3 b){ return degrees(acos(clamp(dot(a,b),-1.0,1.0))); }
float blob(vec3 d, float lat, float lon, float r, float soft){ return 1.0 - smoothstep(r*(1.0-soft), r, angDist(d, dirLL(lat,lon))); }
float blobN(vec3 d, float lat, float lon, float r, float soft, float rough){ float e = fbm(d*5.0 + vec3(lat, lon, r)*0.01, 4)*rough + fbm(d*17.0, 3)*rough*0.3; return 1.0 - smoothstep(r*(1.0-soft), r, angDist(d, dirLL(lat,lon)) + e*r); }
float region(float lat, float lon, float clat, float clon, float hlat, float hlon){
  float dl = mod(lon - clon + 540.0, 360.0) - 180.0;
  vec2 q = vec2((lat-clat)/hlat, dl/hlon);
  return 1.0 - smoothstep(0.55, 1.0, length(q));
}
// crater field on the unit sphere: x = relief, y = fresh-ray factor
vec2 craterField(vec3 d, float scale, float prob, float seed){
  vec3 q = d*scale + seed*7.31;
  vec3 i = floor(q); vec3 f = fract(q);
  float h = 0.0, ray = 0.0;
  for(int x=-1;x<=1+LOOP_ZERO;x++) for(int y=-1;y<=1+LOOP_ZERO;y++) for(int z=-1;z<=1+LOOP_ZERO;z++){
    vec3 c = vec3(float(x),float(y),float(z));
    vec3 r = hash33(i + c + seed);
    if (r.x > prob) continue;
    vec3 fp = c + hash33(i + c + seed + 13.7) - f;
    float rad = 0.16 + 0.34*r.y*r.y;
    float dd = length(fp)/rad;
    if (dd > 2.4) continue;
    float bowl = dd < 1.0 ? (dd*dd - 1.0)*0.9 : 0.0;
    float rim = exp(-pow((dd-1.0)/0.2, 2.0))*0.4;
    float ej = dd > 1.0 ? exp(-(dd-1.0)*2.5)*0.1 : 0.0;
    float fresh = r.z;
    h += (bowl + rim + ej) * mix(0.3, 1.0, fresh) * rad;
    if (fresh > 0.93) ray = max(ray, exp(-max(dd-1.0,0.0)*1.2));
  }
  return vec2(h, ray);
}
vec2 craters(vec3 d, float base){
  vec2 a = craterField(d, base, 0.45, 1.0);
  vec2 b = craterField(d, base*2.3, 0.55, 2.0);
  vec2 c = craterField(d, base*5.1, 0.6, 3.0);
  vec2 e = craterField(d, base*11.0, 0.65, 4.0);
  return vec2(a.x*1.0 + b.x*0.8 + c.x*0.6 + e.x*0.45, max(max(a.y,b.y), c.y*0.7));
}
float rays(vec3 d, float lat, float lon, float rCore, float rLen, float seed){
  vec3 c = dirLL(lat, lon);
  float ad = angDist(d, c);
  if (ad > rLen) return 0.0;
  vec3 t1 = normalize(cross(c, vec3(0.0,1.0,0.0) + vec3(0.001,0.0,0.002)));
  vec3 t2 = cross(c, t1);
  vec3 pr = d - c*dot(d,c);
  float az = atan(dot(pr,t2), dot(pr,t1));
  float s1 = snoise(vec3(cos(az)*5.0, sin(az)*5.0, seed))*0.5+0.5;
  float s2 = snoise(vec3(cos(az)*19.0, sin(az)*19.0, seed+5.0))*0.5+0.5;
  float ray = pow(s1*s2*1.6, 3.0);
  float fall = 1.0 - smoothstep(rCore, rLen, ad);
  float core = 1.0 - smoothstep(rCore*0.6, rCore*1.8, ad);
  return clamp(ray*fall*fall*1.5 + core*0.8, 0.0, 1.0);
}
`;

  const BAKE_MAIN = /* glsl */`
void main(){
  vec3 d = dirFromUv(vUv);
  float lat = degrees(asin(clamp(d.y,-1.0,1.0)));
  float lon = vUv.x*360.0 - 180.0;
  gl_FragColor = clamp(surface(d, lat, lon), 0.0, 1.0);
}`;

  // ---------- per-body surfaces: return vec4(srgb color, height) ----------
  const S = {};

  S.mercury = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 5), n2 = fbm(d*12.0, 4);
  vec2 cr = craters(d, 5.0);
  float cal = blob(d, 30.5, -170.2, 19.0, 0.35);
  vec3 col = mix(vec3(0.40,0.38,0.36), vec3(0.62,0.59,0.55), 0.5+0.45*n);
  col *= 0.9 + 0.12*n2;
  col = mix(col, vec3(0.70,0.63,0.52), cal*0.45);
  col *= 0.93 + cr.x*0.6;
  float r = max(rays(d, 57.8, 16.8, 1.5, 22.0, 3.0), rays(d, -49.5, -64.0, 1.0, 14.0, 9.0)*0.8);
  r = max(r, cr.y*0.5);
  col = mix(col, vec3(0.86,0.84,0.80), r*0.55);
  return vec4(col, clamp(0.5 + cr.x*0.8 + n2*0.05, 0.0, 1.0));
}`;

  S.venus = `
vec4 surface(vec3 d, float lat, float lon){
  vec3 w = vec3(fbm(d*2.0,4), fbm(d*2.0+7.0,4), fbm(d*2.0+13.0,4));
  vec3 p = d + w*0.25;
  float n = fbm(vec3(p.x*2.5, p.y*9.0, p.z*2.5), 6);
  float n2 = fbm(p*7.0, 4);
  // dark Y-shaped equatorial markings, open toward the west
  float yband = exp(-pow((lat - 6.0*sin(radians(lon*2.0)))/18.0, 2.0));
  vec3 col = mix(vec3(0.96,0.90,0.74), vec3(0.80,0.67,0.45), smoothstep(-0.35, 0.65, n + yband*0.35));
  col *= 0.95 + 0.08*n2;
  col = mix(col, vec3(0.98,0.95,0.86), smoothstep(50.0, 80.0, abs(lat))*0.55);
  return vec4(col, 0.5);
}`;

  S.earth = `
uniform sampler2D uMask;
vec4 surface(vec3 d, float lat, float lon){
  vec2 uv = vUv;
  float m = textureLod(uMask, uv, 0.0).r*0.45 + textureLod(uMask, uv, 1.2).r*0.35 + textureLod(uMask, uv, 2.2).r*0.2;
  float jit = fbm(d*140.0, 3)*0.10 + fbm(d*38.0, 3)*0.08;
  float land = smoothstep(0.44, 0.56, m + jit);
  float shelf = textureLod(uMask, uv, 3.0).r;
  float shelf2 = textureLod(uMask, uv, 5.5).r;
  float alat = abs(lat);
  float on = fbm(d*7.0, 4);
  vec3 deep = vec3(0.016, 0.050, 0.125);
  vec3 midc = vec3(0.025, 0.090, 0.185);
  vec3 shallow = vec3(0.050, 0.235, 0.300);
  vec3 ocean = mix(deep, midc, clamp(smoothstep(0.0, 0.3, shelf2) + on*0.12, 0.0, 1.0));
  ocean = mix(ocean, shallow, smoothstep(0.2, 0.8, shelf)*0.75);
  ocean = mix(ocean, vec3(0.045,0.085,0.13), smoothstep(48.0, 72.0, alat)*0.55);

  float n1 = fbm(d*3.0, 5), n1b = fbm(d*3.0 + 11.0, 5), n2 = fbm(d*11.0, 5), n3 = fbm(d*42.0, 4);
  float wlat = lat + n1*6.0, wlon = lon + n1b*9.0;
  float aw = abs(wlat);
  float inland = textureLod(uMask, uv, 6.5).r;
  // moisture from a simple climate picture: wet tropics and storm tracks, dry subtropical highs and deep interiors
  float wet = 0.35 + 0.75*exp(-pow((wlat - 3.0)/12.0, 2.0)) + 0.45*exp(-pow((aw - 52.0)/14.0, 2.0));
  wet -= 0.35*exp(-pow((aw - 24.0)/8.5, 2.0));
  wet -= 0.25*smoothstep(0.75, 1.0, inland)*(1.0 - exp(-pow(wlat/12.0, 2.0)));
  float dry = 0.0;
  dry = max(dry, region(wlat, wlon, 23.0, 12.0, 11.0, 30.0));
  dry = max(dry, region(wlat, wlon, 22.0, 47.0, 10.0, 12.0));
  dry = max(dry, 0.8*region(wlat, wlon, 29.0, 61.0, 7.0, 13.0));
  dry = max(dry, 0.75*region(wlat, wlon, 42.0, 93.0, 6.5, 24.0));
  dry = max(dry, 0.6*region(wlat, wlon, 44.0, 62.0, 6.0, 15.0));
  dry = max(dry, 0.9*region(wlat, wlon, -25.0, 133.0, 10.0, 15.0));
  dry = max(dry, 0.7*region(wlat, wlon, -23.0, 17.0, 7.0, 7.0));
  dry = max(dry, 0.85*region(wlat, wlon, -21.0, -70.0, 10.0, 2.5));
  dry = max(dry, 0.55*region(wlat, wlon, -44.0, -69.0, 7.0, 3.5));
  dry = max(dry, 0.7*region(wlat, wlon, 32.0, -112.0, 7.0, 8.0));
  dry = max(dry, 0.5*region(wlat, wlon, 40.0, -116.0, 4.0, 4.0));
  dry = max(dry, 0.55*region(wlat, wlon, 6.0, 46.0, 5.0, 6.0));
  float moist = 0.0;
  moist = max(moist, region(wlat, wlon, -4.0, -62.0, 11.0, 16.0));
  moist = max(moist, region(wlat, wlon, 0.0, 20.0, 7.0, 11.0));
  moist = max(moist, region(wlat, wlon, 2.0, 112.0, 10.0, 25.0));
  moist = max(moist, 0.8*region(wlat, wlon, 22.0, 88.0, 7.0, 10.0));
  moist = max(moist, 0.8*region(wlat, wlon, 27.0, 113.0, 8.0, 11.0));
  moist = max(moist, 0.7*region(wlat, wlon, 36.0, -84.0, 8.0, 12.0));
  moist = max(moist, 0.7*region(wlat, wlon, 49.0, 10.0, 8.0, 20.0));
  moist = max(moist, 0.7*region(wlat, wlon, 12.0, -85.0, 6.0, 8.0));
  moist = max(moist, 0.6*region(wlat, wlon, 36.0, 138.0, 6.0, 6.0));
  moist = max(moist, 0.5*region(wlat, wlon, -30.0, 151.0, 9.0, 3.5));
  moist = max(moist, 0.5*region(wlat, wlon, -18.0, 48.5, 7.0, 2.0));
  moist = max(moist, 0.6*region(wlat, wlon, 60.0, 60.0, 8.0, 50.0));
  moist = max(moist, 0.6*region(wlat, wlon, 57.0, -100.0, 8.0, 35.0));
  moist = max(moist, 0.7*region(wlat, wlon, 20.0, 78.0, 9.0, 9.0));
  moist = max(moist, 0.75*region(wlat, wlon, -15.0, -50.0, 11.0, 12.0));
  moist = max(moist, 0.7*region(wlat, wlon, -31.0, -58.0, 7.0, 9.0));
  moist = max(moist, 0.5*region(wlat, wlon, -22.0, -61.0, 8.0, 8.0));
  moist = max(moist, 0.75*region(wlat, wlon, -12.0, 28.0, 8.0, 14.0));
  moist = max(moist, 0.6*region(wlat, wlon, -26.0, 30.0, 5.0, 4.0));
  wet = clamp(wet - dry*0.8 + moist*0.45 + n2*0.12 + n3*0.04, 0.0, 1.0);
  float cold = smoothstep(46.0, 66.0, wlat) + smoothstep(48.0, 58.0, -wlat);
  float tundraK = smoothstep(63.0, 71.0, wlat + n2*3.0);
  vec3 sand = vec3(0.83, 0.71, 0.51), redsand = vec3(0.66, 0.44, 0.29), rock = vec3(0.56, 0.49, 0.40);
  vec3 steppe = vec3(0.55, 0.50, 0.33), grass = vec3(0.38, 0.39, 0.20), mixedF = vec3(0.17, 0.24, 0.10);
  vec3 tropF = vec3(0.06, 0.16, 0.05), boreal = vec3(0.08, 0.13, 0.075), tundra = vec3(0.34, 0.32, 0.24);
  float red = clamp(region(wlat, wlon, -24.0, 130.0, 11.0, 17.0) + 0.55*region(wlat, wlon, 21.0, 5.0, 6.0, 12.0) + 0.35*region(wlat, wlon, 24.0, 45.0, 6.0, 8.0), 0.0, 1.0);
  vec3 desert = mix(mix(sand, rock, smoothstep(0.1, 0.6, n2)*0.5), redsand, red*0.75);
  desert *= 0.92 + 0.16*(n3*0.5 + 0.5);
  vec3 forest = mix(mixedF, tropF, 1.0 - smoothstep(14.0, 26.0, aw));
  forest = mix(forest, boreal, clamp(cold, 0.0, 1.0));
  vec3 col = mix(desert, steppe, smoothstep(0.08, 0.2, wet));
  col = mix(col, grass, smoothstep(0.2, 0.36, wet));
  col = mix(col, forest, smoothstep(0.4, 0.62, wet + n2*0.08));
  col = mix(col, tundra, tundraK);
  float fields = smoothstep(0.2, 0.7, fbm(d*28.0, 3)*0.5 + 0.5) * smoothstep(0.35, 0.6, wet) * (1.0 - cold*0.7);
  col = mix(col, grass*1.05, fields*0.35);
  col *= 0.9 + 0.12*(n2*0.5 + 0.5) + 0.03*n3;
  float mtn = ridged(d*22.0, 5);
  float tibet = region(wlat, wlon, 33.0, 87.0, 5.0, 13.0);
  float andes = region(wlat, wlon, -18.0, -68.0, 20.0, 2.2);
  float rockies = region(wlat, wlon, 45.0, -113.0, 12.0, 4.5);
  float alps = region(wlat, wlon, 46.0, 10.0, 1.5, 4.0);
  float high = max(max(tibet, alps), max(andes*0.65, rockies*0.55));
  col = mix(col, vec3(0.44, 0.40, 0.35), high*smoothstep(0.35, 0.7, mtn)*0.65);
  float snow = max(tibet*0.4, max(alps, andes*0.5))*smoothstep(0.8, 0.9, mtn)*0.6;
  float greenland = region(lat, lon, 74.0, -41.0, 12.0, 24.0);
  float ice = max(smoothstep(0.25, 0.65, greenland + n1*0.25), 1.0 - smoothstep(-66.0, -62.0, lat + n1*2.0));
  ice = max(ice, smoothstep(77.0, 81.0, lat + n1*2.0));
  ice = max(ice, snow);
  col = mix(col, vec3(0.90, 0.93, 0.96)*(0.94 + 0.06*n2), clamp(ice, 0.0, 1.0));
  vec3 surf = mix(ocean, col, land);
  float seaIce = smoothstep(74.0, 80.0, lat + fbm(d*9.0,4)*5.0) + (1.0 - smoothstep(-72.0, -67.0, lat + fbm(d*9.0+3.0,4)*4.0));
  surf = mix(surf, vec3(0.78,0.83,0.88)*(0.9+0.1*n2), clamp(seaIce, 0.0, 1.0)*(1.0-land)*0.85);
  float h = land * (0.1 + 0.6*mtn*high + 0.07*mtn + 0.04*n2);
  return vec4(surf, h);
}`;

  S.clouds = `
uniform sampler2D uMask;
vec3 rotAround(vec3 v, vec3 k, float a){ return v*cos(a) + cross(k, v)*sin(a) + k*dot(k, v)*(1.0 - cos(a)); }
vec4 surface(vec3 d, float lat, float lon){
  float alat = abs(lat);
  // cyclones: spin counter-clockwise in the north, clockwise in the south
  vec3 q = d;
  for (int i = 0; i < 14 + LOOP_ZERO; i++) {
    float fi = float(i);
    float clat = (hash11(fi*3.1) < 0.5 ? 1.0 : -1.0) * (i < 3 ? 12.0 + 10.0*hash11(fi+0.3) : 38.0 + 24.0*hash11(fi+0.7));
    float clon = -180.0 + 360.0*hash11(fi*7.7 + 1.0);
    vec3 c = dirLL(clat, clon);
    float size = i < 3 ? 5.0 : 9.0 + 7.0*hash11(fi*1.9);
    float ad = angDist(q, c);
    float a = (clat > 0.0 ? 1.0 : -1.0) * (i < 3 ? 5.0 : 3.2) * exp(-pow(ad/size, 2.0)) * (1.0 - exp(-pow(ad/(size*0.18), 2.0)));
    q = rotAround(q, c, a);
  }
  vec3 w = vec3(fbm(q*2.2, 4), fbm(q*2.2 + 5.2, 4), fbm(q*2.2 + 9.7, 4));
  vec3 p = q + w*0.16;
  float base = fbm(vec3(p.x*3.0, p.y*5.5, p.z*3.0), 5)*0.5 + 0.5;
  float det = fbm(p*18.0, 4)*0.5 + 0.5;
  float cov = 0.50 + 0.12*exp(-pow((lat - 6.0)/6.0, 2.0)) - 0.17*exp(-pow((alat - 23.0)/8.0, 2.0)) + 0.16*exp(-pow((alat - 55.0)/12.0, 2.0)) - 0.12*smoothstep(70.0, 88.0, alat);
  float v = base + (det - 0.5)*0.32;
  float c = smoothstep(1.0 - cov, 1.0 - cov + 0.16, v);
  // trade-wind cumulus fields over the subtropical oceans
  float sea = 1.0 - textureLod(uMask, vUv, 2.0).r;
  float cu = smoothstep(0.6, 0.85, fbm(p*40.0, 3)*0.5 + 0.5) * exp(-pow((alat - 17.0)/9.0, 2.0)) * sea;
  c = max(c*(0.6 + 0.4*det), cu*0.3);
  return vec4(c, c, c, c);
}`;

  S.moon = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 5), n2 = fbm(d*14.0, 4);
  float w = fbm(d*6.0, 4)*3.5;
  float mare = 0.0;
  mare = max(mare, blobN(d, 32.8 + w, -15.6, 18.5, 0.25, 0.45));
  mare = max(mare, blobN(d, 28.0, 17.5 + w, 10.8, 0.25, 0.45));
  mare = max(mare, blobN(d, 8.5 + w, 31.4, 13.8, 0.3, 0.45));
  mare = max(mare, blobN(d, 17.0, 59.1 + w*0.5, 8.6, 0.2, 0.45));
  mare = max(mare, blobN(d, -7.8 + w, 51.3, 12.0, 0.35, 0.45));
  mare = max(mare, blobN(d, -15.2, 35.5, 5.5, 0.3, 0.45));
  mare = max(mare, blobN(d, -21.3 + w, -16.6, 11.0, 0.3, 0.45));
  mare = max(mare, blobN(d, -24.4, -38.6, 6.4, 0.25, 0.45));
  mare = max(mare, blobN(d, 13.3, 3.6, 4.5, 0.4, 0.45));
  mare = max(mare, blobN(d, -10.0, -23.0 + w, 6.5, 0.4, 0.45));
  mare = max(mare, blobN(d, 7.5, -30.9, 7.5, 0.4, 0.45));
  // Oceanus Procellarum
  mare = max(mare, blobN(d, 20.0 + w, -57.0, 17.0, 0.35, 0.45));
  mare = max(mare, blobN(d, 5.0, -50.0 + w, 14.0, 0.35, 0.45));
  mare = max(mare, blobN(d, 36.0, -45.0, 12.0, 0.4, 0.45));
  mare = max(mare, blobN(d, -8.0, -40.0, 9.0, 0.4, 0.45));
  // Mare Frigoris
  mare = max(mare, region(lat + w*0.4, lon, 56.0, 0.0, 4.0, 42.0));
  mare = max(mare, blobN(d, 1.3, 87.3, 5.0, 0.4, 0.45)*0.8);
  mare = max(mare, blobN(d, 13.3, 86.1, 4.5, 0.4, 0.45)*0.7);
  mare = max(mare, blobN(d, -38.9, 93.0, 8.0, 0.5, 0.45)*0.6);
  mare = max(mare, blobN(d, -19.4, -92.8, 3.5, 0.4, 0.45)*0.8);
  mare = max(mare, blobN(d, 27.3, 147.9, 3.5, 0.4, 0.45)*0.7);
  mare = clamp(mare * (0.85 + 0.25*n), 0.0, 1.0);
  vec2 cr = craters(d, 5.5);
  vec3 high = mix(vec3(0.60,0.58,0.55), vec3(0.74,0.72,0.68), 0.5+0.5*n2);
  vec3 sea = mix(vec3(0.27,0.27,0.28), vec3(0.36,0.35,0.34), 0.5+0.5*n2);
  vec3 col = mix(high, sea, mare);
  col *= 0.94 + cr.x*mix(0.55, 0.3, mare);
  float r = rays(d, -43.3, -11.2, 1.3, 32.0, 1.0);
  r = max(r, rays(d, 9.6, -20.1, 1.4, 14.0, 4.0)*0.85);
  r = max(r, rays(d, 8.1, -38.0, 0.9, 8.0, 7.0)*0.7);
  r = max(r, rays(d, 23.7, -47.4, 0.7, 6.0, 9.0)*0.9);
  r = max(r, cr.y*0.45);
  col = mix(col, vec3(0.86,0.85,0.82), r*0.6);
  return vec4(col, clamp(0.5 + cr.x*0.75 - mare*0.06, 0.0, 1.0));
}`;

  S.mars = `
float darkF(float lat, float lon, float clat, float clon, float hlat, float hlon, float k){ return k*region(lat, lon, clat, clon, hlat, hlon); }
float distSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 6), n2 = fbm(d*12.0, 4), n3 = fbm(d*40.0, 3);
  float wl = lat + n*6.0, wo = lon + fbm(d*3.0+5.0, 5)*9.0;
  vec3 bright = vec3(0.80, 0.52, 0.32);
  vec3 mid = vec3(0.66, 0.38, 0.22);
  vec3 dark = vec3(0.30, 0.20, 0.15);
  vec3 col = mix(mid, bright, smoothstep(-0.4, 0.5, n));
  float dk = 0.0;
  dk = max(dk, darkF(wl, wo, 9.0, 70.0, 13.0, 9.0, 1.0));
  dk = max(dk, darkF(wl, wo, -4.0, 76.0, 9.0, 14.0, 0.8));
  dk = max(dk, darkF(wl, wo, -6.0, 12.0, 5.5, 26.0, 0.9));
  dk = max(dk, darkF(wl, wo, -25.0, -40.0, 10.0, 28.0, 0.7));
  dk = max(dk, darkF(wl, wo, -10.0, -22.0, 7.0, 9.0, 0.6));
  dk = max(dk, darkF(wl, wo, -15.0, -50.0, 5.0, 9.0, 0.55));
  dk = max(dk, darkF(wl, wo, -26.0, -88.0, 5.0, 8.0, 0.75));
  dk = max(dk, darkF(wl, wo, -30.0, -155.0, 8.0, 26.0, 0.8));
  dk = max(dk, darkF(wl, wo, -21.0, 145.0, 9.0, 26.0, 0.85));
  dk = max(dk, darkF(wl, wo, -18.0, 110.0, 8.0, 15.0, 0.8));
  dk = max(dk, darkF(wl, wo, -22.0, 78.0, 6.0, 10.0, 0.6));
  dk = max(dk, darkF(wl, wo, 47.0, -30.0, 12.0, 18.0, 0.85));
  dk = max(dk, darkF(wl, wo, 47.0, 112.0, 10.0, 26.0, 0.45));
  dk = max(dk, darkF(wl, wo, -60.0, 60.0, 6.0, 40.0, 0.5));
  dk = max(dk, darkF(wl, wo, 25.0, -5.0, 7.0, 12.0, 0.45));
  dk *= 0.75 + 0.35*smoothstep(-0.3, 0.6, n2);
  col = mix(col, dark, clamp(dk, 0.0, 1.0)*0.85);
  float hellas = blob(d, -42.4, 70.5, 15.0, 0.4);
  float argyre = blob(d, -49.7, -43.0, 7.5, 0.4);
  col = mix(col, vec3(0.86,0.66,0.48), max(hellas, argyre)*0.7);
  // Tharsis volcanoes
  float olym = blob(d, 18.65, -133.8, 5.0, 0.15);
  float olymRim = exp(-pow((angDist(d, dirLL(18.65,-133.8)) - 5.0)/0.45, 2.0));
  col = mix(col, vec3(0.72,0.48,0.32), olym*0.6);
  col *= 1.0 - olymRim*0.35;
  float th = max(max(blob(d,-8.3,-120.1,2.6,0.3), blob(d,1.5,-113.0,2.4,0.3)), max(blob(d,11.8,-104.5,2.6,0.3), blob(d,25.0,147.0,2.4,0.3)));
  col = mix(col, vec3(0.70,0.46,0.30), th*0.6);
  float cald = max(max(blob(d,18.65,-133.8,0.9,0.3), blob(d,-8.3,-120.1,0.6,0.3)), max(blob(d,1.5,-113.0,0.5,0.3), blob(d,11.8,-104.5,0.5,0.3)));
  col *= 1.0 - cald*0.35;
  // Valles Marineris
  vec2 p = vec2(lon*cos(radians(lat)), lat);
  float vm = 1e3;
  vm = min(vm, distSeg(p, vec2(-102.0*0.99,-7.0), vec2(-85.0*0.985,-10.0)));
  vm = min(vm, distSeg(p, vec2(-85.0*0.985,-10.0), vec2(-70.0*0.978,-12.0)));
  vm = min(vm, distSeg(p, vec2(-70.0*0.978,-12.0), vec2(-59.0*0.97,-14.0)));
  vm = min(vm, distSeg(p, vec2(-59.0*0.97,-14.0), vec2(-48.0*0.98,-11.0)));
  vm = min(vm, distSeg(p, vec2(-48.0*0.98,-11.0), vec2(-38.0*0.995,-6.0)));
  float valles = 1.0 - smoothstep(0.4, 1.6 + n2*0.5, vm);
  col = mix(col, vec3(0.32,0.20,0.15), valles*0.75);
  vec2 cr = craters(d, 6.0);
  col *= 0.97 + cr.x*0.28;
  col *= 0.94 + 0.08*n3;
  // polar caps
  float north = smoothstep(77.0, 81.0, lat + fbm(d*10.0,4)*3.0 + ridged(d*16.0,3)*2.0);
  float south = blob(d, -87.0, -40.0, 6.5 + fbm(d*10.0,4)*2.0, 0.4);
  col = mix(col, vec3(0.94,0.93,0.92), clamp(north + south, 0.0, 1.0));
  float h = 0.45 + cr.x*0.15 + olym*0.25 + th*0.2 - valles*0.3 - hellas*0.1 + n2*0.03;
  return vec4(col, clamp(h, 0.0, 1.0));
}`;

  S.jupiter = `
vec3 jband(float l){
  vec3 c = vec3(0.58,0.55,0.50);
  c = mix(c, vec3(0.78,0.73,0.62), sstep(50.0, 45.0, l));
  c = mix(c, vec3(0.64,0.56,0.46), sstep(39.0, 36.0, l));
  c = mix(c, vec3(0.86,0.82,0.72), sstep(34.0, 32.0, l));
  c = mix(c, vec3(0.68,0.53,0.40), sstep(28.5, 26.5, l));
  c = mix(c, vec3(0.90,0.86,0.77), sstep(23.5, 21.5, l));
  c = mix(c, vec3(0.55,0.37,0.26), sstep(18.5, 16.5, l));
  c = mix(c, vec3(0.94,0.88,0.75), sstep(8.0, 6.0, l));
  c = mix(c, vec3(0.62,0.44,0.31), sstep(-7.0, -9.0, l));
  c = mix(c, vec3(0.92,0.88,0.79), sstep(-19.0, -21.0, l));
  c = mix(c, vec3(0.70,0.58,0.46), sstep(-27.0, -29.0, l));
  c = mix(c, vec3(0.84,0.79,0.69), sstep(-33.0, -35.0, l));
  c = mix(c, vec3(0.66,0.60,0.52), sstep(-40.0, -42.0, l));
  c = mix(c, vec3(0.60,0.57,0.52), sstep(-50.0, -55.0, l));
  return c;
}
vec4 surface(vec3 d, float lat, float lon){
  vec3 s1 = vec3(d.x*1.6, d.y*12.0, d.z*1.6);
  vec3 w = vec3(fbm(s1, 4), fbm(s1 + 4.1, 4), fbm(s1 + 8.3, 4));
  float t1 = fbm(vec3(d.x*3.5, d.y*34.0, d.z*3.5) + w*1.3, 5);
  float t2 = fbm(vec3(d.x*9.0, d.y*80.0, d.z*9.0) + vec3(t1*1.8, w.y, t1), 4);
  float t3 = fbm(vec3(d.x*24.0, d.y*140.0, d.z*24.0) + vec3(t2*1.5), 3);
  float edgeK = 0.6 + 0.8*smoothstep(0.0, 0.5, abs(fbm(d*vec3(3.0, 1.0, 3.0) + 2.0, 3)));
  float lw = lat + (t1*3.2 + t2*1.1 + t3*0.3)*edgeK;
  vec3 col = jband(lw);
  vec3 alt = jband(lw + 3.2*sign(t1 + 0.0001));
  col = mix(col, alt, smoothstep(0.15, 0.6, abs(t2))*0.4);
  col *= 0.86 + 0.2*(t2*0.5 + 0.5) + 0.08*t3;
  col *= 0.9 + 0.2*(fbm(vec3(d.x*10.0, d.y*30.0, d.z*10.0) + w*2.0, 4)*0.5 + 0.5);
  for (int k = 0; k < 40 + LOOP_ZERO; k++) {
    float fk = float(k);
    float h1 = hash11(fk*1.37 + 0.2), h2 = hash11(fk*2.91 + 5.1), h3 = hash11(fk*4.13 + 9.7);
    float la = h1 < 0.22 ? 19.0 + h2*4.0 : (h1 < 0.45 ? -41.0 + h2*3.0 : (h1 < 0.66 ? 15.0 + h2*2.0 : (h1 < 0.84 ? -26.0 + h2*2.5 : 31.0 + h2*4.0)));
    float lo = -180.0 + 360.0*hash11(fk*7.77 + 3.3);
    float dd = mod(lon - lo + 540.0, 360.0) - 180.0;
    float sz = 0.7 + 1.5*h3;
    float o = length(vec2(dd/(sz*2.3), (lat - la)/sz));
    vec3 oc = (h1 >= 0.45 && h1 < 0.66) ? vec3(0.42, 0.27, 0.2) : vec3(0.96, 0.94, 0.89);
    col = mix(col, oc, (1.0 - smoothstep(0.5, 1.0, o))*0.7);
    col = mix(col, col*0.85, exp(-pow((o - 1.15)/0.18, 2.0))*0.5);
  }
  float pol = smoothstep(46.0, 68.0, abs(lat));
  float cells = fbm(d*26.0 + w, 4);
  col = mix(col, col*(0.72 + 0.4*(cells*0.5 + 0.5))*vec3(0.9, 0.95, 1.04), pol);
  float fest = smoothstep(0.55, 0.8, fbm(vec3(d.x*14.0, d.y*30.0, d.z*14.0), 3)*0.5+0.5) * exp(-pow((lat-7.0)/1.8, 2.0));
  col = mix(col, vec3(0.36,0.37,0.42), fest*0.7);
  // Great Red Spot
  float dl = mod(lon + 40.0 + 540.0, 360.0) - 180.0;
  vec2 e = vec2(dl/6.8, (lat + 22.4)/4.5);
  float er = length(e);
  float ang = atan(e.y, e.x) + (1.0 - smoothstep(0.0, 1.3, er))*3.5;
  float sw = snoise(vec3(cos(ang)*er*3.0, sin(ang)*er*3.0, 7.0));
  vec3 grs = mix(vec3(0.72,0.36,0.22), vec3(0.86,0.56,0.38), 0.5+0.5*sw);
  grs = mix(grs, vec3(0.60,0.28,0.18), 1.0 - smoothstep(0.0, 0.55, er));
  col = mix(col, vec3(0.95,0.91,0.83), (1.0 - smoothstep(1.0, 1.7, er))*0.65);
  col = mix(col, grs, 1.0 - smoothstep(0.82, 1.0, er));
  // Oval BA and white ovals
  float dl2 = mod(lon - 60.0 + 540.0, 360.0) - 180.0;
  float ba = length(vec2(dl2/3.0, (lat + 33.0)/2.2));
  col = mix(col, vec3(0.80,0.58,0.48), 1.0 - smoothstep(0.7, 1.0, ba));
  for (int k = 0; k < 6 + LOOP_ZERO; k++) {
    float fk = float(k);
    float ol = -150.0 + fk*55.0 + hash11(fk)*20.0;
    float la = -41.0 + hash11(fk+3.0)*2.0;
    float dd = mod(lon - ol + 540.0, 360.0) - 180.0;
    float o = length(vec2(dd/2.0, (lat - la)/1.3));
    col = mix(col, vec3(0.93,0.91,0.86), (1.0 - smoothstep(0.6, 1.0, o))*0.8);
  }
  return vec4(col, 0.5);
}`;

  S.saturn = `
vec3 sband(float l){
  vec3 c = vec3(0.66,0.66,0.62);
  c = mix(c, vec3(0.80,0.74,0.58), sstep(68.0, 62.0, l));
  c = mix(c, vec3(0.76,0.67,0.50), sstep(52.0, 48.0, l));
  c = mix(c, vec3(0.88,0.80,0.61), sstep(42.0, 38.0, l));
  c = mix(c, vec3(0.80,0.70,0.51), sstep(28.0, 24.0, l));
  c = mix(c, vec3(0.93,0.86,0.68), sstep(14.0, 10.0, l));
  c = mix(c, vec3(0.86,0.76,0.56), sstep(-10.0, -14.0, l));
  c = mix(c, vec3(0.91,0.83,0.65), sstep(-25.0, -29.0, l));
  c = mix(c, vec3(0.80,0.72,0.55), sstep(-44.0, -49.0, l));
  c = mix(c, vec3(0.72,0.69,0.62), sstep(-64.0, -72.0, l));
  return c;
}
vec4 surface(vec3 d, float lat, float lon){
  float t1 = fbm(vec3(d.x*3.0, d.y*16.0, d.z*3.0), 5);
  float t2 = fbm(vec3(d.x*10.0, d.y*60.0, d.z*10.0) + t1, 4);
  float lw = lat + t1*1.4 + t2*0.6;
  vec3 col = sband(lw);
  col *= 0.95 + 0.06*t2 + 0.04*sin(lw*2.2);
  // north polar hexagon (jet at ~78 N)
  float colat = 90.0 - lat;
  float a6 = mod(radians(lon) + 0.35, PI/3.0) - PI/6.0;
  float hr = 11.5/cos(a6);
  float inside = 1.0 - smoothstep(-0.6, 0.6, colat - hr);
  col = mix(col, vec3(0.56,0.60,0.62), inside*0.55);
  col = mix(col, vec3(0.48,0.50,0.50), exp(-pow((colat - hr)/0.7, 2.0))*0.45);
  col = mix(col, vec3(0.36,0.37,0.38), 1.0 - smoothstep(0.0, 2.8, colat));
  return vec4(col, 0.5);
}`;

  S.uranus = `
vec4 surface(vec3 d, float lat, float lon){
  float t = fbm(vec3(d.x*2.0, d.y*10.0, d.z*2.0), 4);
  vec3 col = vec3(0.68,0.85,0.87);
  col *= 0.97 + 0.04*t + 0.015*sin(lat*0.5);
  col = mix(col, vec3(0.80,0.92,0.93), smoothstep(45.0, 75.0, lat)*0.7);
  col = mix(col, col*0.95, exp(-pow((lat+20.0)/8.0,2.0))*0.4);
  return vec4(col, 0.5);
}`;

  S.neptune = `
vec4 surface(vec3 d, float lat, float lon){
  float t1 = fbm(vec3(d.x*2.5, d.y*12.0, d.z*2.5), 5);
  float lw = lat + t1*4.0;
  vec3 col = vec3(0.52,0.69,0.88);
  col = mix(col, vec3(0.42,0.58,0.82), exp(-pow((lw+28.0)/9.0, 2.0))*0.7);
  col = mix(col, vec3(0.58,0.74,0.90), exp(-pow(lw/10.0, 2.0))*0.4);
  col = mix(col, vec3(0.45,0.61,0.84), smoothstep(55.0, 80.0, abs(lw))*0.5);
  float streak = fbm(vec3(d.x*5.0, d.y*40.0, d.z*5.0), 4);
  float c1 = smoothstep(0.32, 0.6, streak) * (exp(-pow((lat+42.0)/6.0,2.0)) + exp(-pow((lat-28.0)/5.0,2.0))*0.6 + exp(-pow((lat+20.0)/3.0,2.0))*0.5);
  col = mix(col, vec3(0.95,0.97,1.0), clamp(c1, 0.0, 1.0)*0.85);
  float dl = mod(lon - 30.0 + 540.0, 360.0) - 180.0;
  float sp = length(vec2(dl/7.0, (lat - 20.0)/3.5));
  col = mix(col, vec3(0.25,0.36,0.62), (1.0 - smoothstep(0.6, 1.0, sp))*0.8);
  float comp = length(vec2((dl+3.0)/6.0, (lat - 25.0)/1.4));
  col = mix(col, vec3(0.95,0.97,1.0), (1.0 - smoothstep(0.5, 1.0, comp))*0.8);
  return vec4(col, 0.5);
}`;

  S.pluto = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.5, 6), n2 = fbm(d*14.0, 4);
  float wl = lat + n*6.0, wo = lon + fbm(d*3.0+3.0,5)*10.0;
  vec3 col = mix(vec3(0.60,0.46,0.34), vec3(0.82,0.70,0.56), 0.5 + 0.5*n);
  float cth = region(wl, wo, -4.0, 95.0, 18.0, 58.0);
  col = mix(col, vec3(0.28,0.15,0.10), cth*0.92);
  float sp = region(wl, wo, 22.0, 177.0, 18.0, 15.0);
  float east = region(wl, wo, 0.0, -150.0, 24.0, 22.0);
  float heart = max(sp, east*0.8);
  col = mix(col, vec3(0.97,0.93,0.88), heart);
  float cells = fbm(d*30.0, 3);
  col *= 1.0 - sp*smoothstep(0.1, 0.3, abs(cells))*0.08;
  col = mix(col, vec3(0.72,0.66,0.62), smoothstep(55.0, 78.0, lat)*0.55);
  col *= 0.92 + 0.12*n2;
  vec2 cr = craters(d, 4.0);
  col *= 0.985 + cr.x*0.12*(1.0 - heart);
  return vec4(col, clamp(0.5 + cr.x*0.15*(1.0-heart) + n2*0.03, 0.0, 1.0));
}`;

  S.charon = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*4.0, 5), n2 = fbm(d*14.0, 4);
  vec3 col = mix(vec3(0.48,0.46,0.45), vec3(0.66,0.64,0.62), 0.5+0.5*n);
  float mordor = smoothstep(58.0, 75.0, lat + n*6.0);
  col = mix(col, vec3(0.40,0.20,0.14), mordor*0.85);
  float belt = exp(-pow((lat - 5.0 - n*6.0)/4.0, 2.0)) * smoothstep(0.0, 0.4, ridged(d*8.0,3));
  col *= 1.0 - belt*0.25;
  vec2 cr = craters(d, 5.0);
  col *= 0.92 + cr.x*1.1 + n2*0.06;
  return vec4(col, clamp(0.5 + cr.x + belt*0.2, 0.0, 1.0));
}`;

  S.io = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*4.0, 5), n2 = fbm(d*12.0, 4), n3 = fbm(d*30.0, 3);
  vec3 col = mix(vec3(0.86,0.76,0.36), vec3(0.96,0.92,0.66), 0.5+0.5*n);
  col = mix(col, vec3(0.82,0.55,0.24), smoothstep(0.15, 0.55, n2)*0.55);
  col = mix(col, vec3(0.97,0.96,0.88), smoothstep(0.35, 0.7, -n2)*0.5);
  col = mix(col, vec3(0.55,0.42,0.32), smoothstep(50.0, 75.0, abs(lat))*0.65);
  vec3 q = d*6.0; vec3 i = floor(q), f = fract(q);
  for(int x=-1;x<=1+LOOP_ZERO;x++) for(int y=-1;y<=1+LOOP_ZERO;y++) for(int z=-1;z<=1+LOOP_ZERO;z++){
    vec3 c = vec3(float(x),float(y),float(z));
    vec3 r = hash33(i+c+21.0);
    if (r.x > 0.45) continue;
    float dd = length(c + hash33(i+c+4.0) - f) / (0.05 + 0.1*r.y);
    col = mix(col, vec3(0.14,0.11,0.09), (1.0 - smoothstep(0.5, 1.0, dd))*0.9);
    if (r.z > 0.75) col = mix(col, vec3(0.78,0.30,0.14), exp(-pow((dd-2.4)/0.9,2.0))*0.6);
  }
  col *= 0.93 + 0.1*n3;
  return vec4(col, 0.5 + n2*0.1);
}`;

  S.europa = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 5), n2 = fbm(d*10.0, 4);
  vec3 col = mix(vec3(0.80,0.75,0.66), vec3(0.92,0.89,0.84), 0.5+0.5*n);
  float chaos = smoothstep(0.1, 0.5, fbm(d*5.0+2.0, 5));
  col = mix(col, vec3(0.62,0.50,0.40), chaos*0.5);
  float lines = 0.0;
  lines = max(lines, pow(1.0 - abs(snoise(vec3(d.x*3.0, d.y*3.0, d.z*3.0) + n*0.5)), 34.0));
  lines = max(lines, pow(1.0 - abs(snoise(vec3(d.z*5.0, d.x*5.0, d.y*5.0) + 3.0)), 44.0));
  lines = max(lines, pow(1.0 - abs(snoise(vec3(d.y*8.0, d.z*8.0, d.x*8.0) + 7.0)), 54.0)*0.7);
  col = mix(col, vec3(0.52,0.32,0.20), lines*0.75);
  return vec4(col, 0.5 + lines*0.12 + n2*0.04);
}`;

  S.ganymede = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*2.4, 6), n2 = fbm(d*10.0, 4);
  float t = smoothstep(-0.12, 0.18, n);
  vec3 dark = vec3(0.36,0.32,0.27), bright = vec3(0.68,0.65,0.60);
  float grooves = pow(1.0 - abs(snoise(vec3(d.x*20.0, d.y*6.0, d.z*20.0) + n*2.0)), 8.0);
  vec3 col = mix(dark, bright, t);
  col = mix(col, col*0.85, grooves*t*0.5);
  col = mix(col, vec3(0.82,0.82,0.82), smoothstep(62.0, 80.0, abs(lat))*0.4);
  vec2 cr = craters(d, 5.0);
  col *= 0.92 + cr.x*0.9 + n2*0.06;
  col = mix(col, vec3(0.88,0.88,0.86), cr.y*0.5);
  return vec4(col, clamp(0.5 + cr.x + grooves*t*0.06, 0.0, 1.0));
}`;

  S.callisto = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 5), n2 = fbm(d*12.0, 4);
  vec3 col = mix(vec3(0.24,0.21,0.18), vec3(0.40,0.36,0.31), 0.5+0.5*n);
  vec3 q = d*14.0; vec3 i = floor(q), f = fract(q);
  for(int x=-1;x<=1+LOOP_ZERO;x++) for(int y=-1;y<=1+LOOP_ZERO;y++) for(int z=-1;z<=1+LOOP_ZERO;z++){
    vec3 c = vec3(float(x),float(y),float(z));
    vec3 r = hash33(i+c+31.0);
    if (r.x > 0.55) continue;
    float dd = length(c + hash33(i+c+8.0) - f) / (0.06 + 0.12*r.y);
    col = mix(col, vec3(0.80,0.78,0.74), (1.0 - smoothstep(0.3, 1.0, dd))*0.7);
  }
  float vr = angDist(d, dirLL(15.0, -56.0));
  col = mix(col, vec3(0.62,0.58,0.52), (1.0 - smoothstep(4.0, 9.0, vr))*0.6);
  col *= 1.0 + 0.08*sin(vr*1.6)*(1.0 - smoothstep(10.0, 40.0, vr));
  vec2 cr = craters(d, 5.5);
  col *= 0.9 + cr.x*1.0 + n2*0.06;
  return vec4(col, clamp(0.5 + cr.x, 0.0, 1.0));
}`;

  S.titan = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(vec3(d.x*2.0, d.y*6.0, d.z*2.0), 4);
  vec3 col = mix(vec3(0.78,0.52,0.20), vec3(0.88,0.64,0.30), 0.5+0.3*n);
  col = mix(col, vec3(0.70,0.48,0.24), smoothstep(40.0, 75.0, lat)*0.4);
  return vec4(col, 0.5);
}`;

  S.enceladus = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*4.0, 5), n2 = fbm(d*14.0, 3);
  vec3 col = mix(vec3(0.88,0.90,0.92), vec3(0.98,0.98,0.99), 0.5+0.5*n);
  float s = 0.0;
  if (lat < -55.0) {
    vec2 p = vec2(d.x, d.z) / (1.0 - d.y);
    float u = dot(p, normalize(vec2(1.0, 0.7)))*28.0 + n*0.6;
    s = exp(-pow((fract(u) - 0.5)/0.08, 2.0)) * (1.0 - smoothstep(-70.0, -58.0, lat)) * step(abs(u), 2.2);
  }
  col = mix(col, vec3(0.55,0.72,0.82), s*0.8);
  vec2 cr = craters(d, 4.0);
  col *= 0.97 + cr.x*0.5*smoothstep(-20.0, 20.0, lat);
  return vec4(col, clamp(0.5 + cr.x*0.6 - s*0.15 + n2*0.04, 0.0, 1.0));
}`;

  const grey = (a, b, crk) => `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.5, 5), n2 = fbm(d*12.0, 4);
  vec3 col = mix(vec3(${a}), vec3(${b}), 0.5+0.5*n);
  vec2 cr = craters(d, ${crk});
  col *= 0.9 + cr.x*1.2 + n2*0.07;
  col = mix(col, col*1.35, cr.y*0.4);
  return vec4(col, clamp(0.5 + cr.x*1.1, 0.0, 1.0));
}`;
  S.titania = grey('0.48,0.46,0.44', '0.64,0.62,0.59', '5.0');
  S.oberon = grey('0.38,0.35,0.33', '0.54,0.50,0.47', '5.5');
  S.phobos = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 5), n2 = fbm(d*10.0, 4);
  vec3 col = mix(vec3(0.26,0.24,0.22), vec3(0.40,0.36,0.32), 0.5+0.5*n);
  vec2 cr = craters(d, 3.5);
  float st = angDist(d, dirLL(1.0, -49.0));
  float stick = 1.0 - smoothstep(20.0, 24.0, st);
  col *= 0.88 + cr.x*1.4 + n2*0.08;
  col *= 1.0 - stick*0.25*(1.0 - st/24.0);
  float grooves = pow(1.0 - abs(sin(d.y*60.0 + n*3.0)), 12.0) * 0.12;
  col *= 1.0 - grooves;
  return vec4(col, clamp(0.5 + cr.x*1.2 - stick*0.3*(1.0 - st/24.0), 0.0, 1.0));
}`;
  S.deimos = grey('0.36,0.33,0.30', '0.48,0.44,0.40', '3.0');
  S.halley = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.0, 5), n2 = fbm(d*11.0, 4);
  vec3 col = mix(vec3(0.07, 0.065, 0.06), vec3(0.17, 0.16, 0.15), 0.5 + 0.5*n);
  col *= 0.9 + 0.2*n2;
  col = mix(col, vec3(0.55, 0.55, 0.53), smoothstep(0.55, 0.75, n2)*0.35);
  return vec4(col, clamp(0.5 + n*0.25 + n2*0.08, 0.0, 1.0));
}`;
  S.miranda = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*3.5, 5), n2 = fbm(d*12.0, 4);
  vec3 col = mix(vec3(0.55,0.54,0.52), vec3(0.72,0.71,0.69), 0.5+0.5*n);
  float cor = 0.0;
  vec3 cs[3]; cs[0] = dirLL(-40.0, 0.0); cs[1] = dirLL(-30.0, 120.0); cs[2] = dirLL(-35.0, -110.0);
  for (int k = 0; k < 3 + LOOP_ZERO; k++) {
    float ad = angDist(d, cs[k]);
    float inside = 1.0 - smoothstep(26.0, 32.0, ad + n*6.0);
    float bands = 0.5 + 0.5*sin(ad*1.4 + n*2.0);
    cor = max(cor, inside*bands);
  }
  col = mix(col, vec3(0.40,0.39,0.38), cor*0.55);
  vec2 cr = craters(d, 4.5);
  col *= 0.92 + cr.x*1.0 + n2*0.06;
  return vec4(col, clamp(0.5 + cr.x + cor*0.15, 0.0, 1.0));
}`;
  S.triton = `
vec4 surface(vec3 d, float lat, float lon){
  float n = fbm(d*4.0, 5), n2 = fbm(d*14.0, 4);
  vec3 col = mix(vec3(0.70,0.66,0.60), vec3(0.82,0.76,0.70), 0.5+0.5*n);
  float cap = 1.0 - smoothstep(-25.0, -10.0, lat + n*8.0);
  col = mix(col, vec3(0.93,0.86,0.80), cap*0.85);
  float streak = smoothstep(0.55, 0.8, fbm(vec3(d.x*14.0, d.y*4.0, d.z*14.0), 3)*0.5+0.5) * cap;
  col = mix(col, vec3(0.35,0.30,0.28), streak*0.6);
  vec3 q = d*20.0; vec3 i = floor(q), f = fract(q);
  float md = 1.0;
  for(int x=-1;x<=1+LOOP_ZERO;x++) for(int y=-1;y<=1+LOOP_ZERO;y++) for(int z=-1;z<=1+LOOP_ZERO;z++){
    vec3 c = vec3(float(x),float(y),float(z));
    md = min(md, length(c + hash33(i+c) - f));
  }
  float cant = smoothstep(0.0, 25.0, lat) * smoothstep(0.25, 0.6, md);
  col = mix(col, col*0.82, cant*0.5);
  col *= 0.95 + 0.08*n2;
  return vec4(col, clamp(0.5 + cant*0.1 - streak*0.05, 0.0, 1.0));
}`;

  // ---------- runtime shaders ----------
  const RING_FN = /* glsl */`
float rn1(float x){ float i=floor(x), f=fract(x); return mix(fract(sin(i*12.9898)*43758.5453), fract(sin((i+1.0)*12.9898)*43758.5453), smoothstep(0.0,1.0,f)); }
float aaBand(float km, float c, float w, float fw){ float we = max(w, fw); return (max(w, 0.2*fw)/we)*exp(-pow((km-c)/we, 2.0)); }
float saturnRing(float r, float fw){
  float km = r*60268.0;
  float d = 0.0;
  d += 0.035 * smoothstep(66900.0, 67500.0, km) * (1.0 - smoothstep(73900.0, 74510.0, km));
  float cR = smoothstep(74490.0, 74658.0, km) * (1.0 - smoothstep(91900.0, 92000.0, km));
  float hf = 1.0 - smoothstep(30.0, 300.0, fw);
  d += cR * (0.11 + 0.05*sin(km*0.0021) + 0.07*(rn1(km*0.004)-0.5) + 0.06*hf*(rn1(km*0.03)-0.5));
  float bR = smoothstep(91900.0, 92150.0, km) * (1.0 - smoothstep(117480.0, 117580.0, km));
  float bP = mix(0.55, 0.95, smoothstep(92000.0, 103000.0, km)) * (1.0 - 0.12*smoothstep(108000.0, 117500.0, km));
  d += bR * clamp(bP + 0.12*(rn1(km*0.0035)-0.5) + 0.12*hf*(rn1(km*0.025)-0.5), 0.0, 1.0);
  float cas = smoothstep(117580.0, 117800.0, km) * (1.0 - smoothstep(121900.0, 122170.0, km));
  d += cas * (0.07 + 0.05*rn1(km*0.01));
  float aR = smoothstep(122050.0, 122200.0, km) * (1.0 - smoothstep(136650.0, 136775.0, km));
  float aP = 0.62 - 0.14*smoothstep(127000.0, 136000.0, km) + 0.06*(rn1(km*0.006)-0.5);
  float gaps = (1.0 - aaBand(km, 133589.0, 160.0, fw)) * (1.0 - aaBand(km, 136505.0, 21.0, fw));
  d += aR * aP * gaps;
  d += 0.5 * aaBand(km, 140180.0, 200.0, fw);
  return clamp(d, 0.0, 1.0);
}
vec3 saturnRingColor(float r){
  float km = r*60268.0;
  vec3 c = vec3(0.52,0.48,0.44);
  c = mix(c, vec3(0.86,0.79,0.66), smoothstep(91000.0, 95000.0, km));
  c = mix(c, vec3(0.80,0.74,0.64), smoothstep(110000.0, 117000.0, km));
  c = mix(c, vec3(0.55,0.53,0.52), smoothstep(117300.0, 117800.0, km) * (1.0 - smoothstep(121800.0, 122300.0, km)));
  c = mix(c, vec3(0.76,0.73,0.68), smoothstep(122000.0, 122400.0, km));
  c = mix(c, vec3(0.85,0.85,0.85), smoothstep(138000.0, 139500.0, km));
  return c;
}
float uranusRing(float r, float fw){
  float km = r*25559.0;
  float d = 0.0;
  d += 0.35*aaBand(km, 41837.0, 2.0, fw);
  d += 0.35*aaBand(km, 42234.0, 2.0, fw);
  d += 0.35*aaBand(km, 42571.0, 2.0, fw);
  d += 0.5*aaBand(km, 44718.0, 6.0, fw);
  d += 0.5*aaBand(km, 45661.0, 6.0, fw);
  d += 0.4*aaBand(km, 47176.0, 2.0, fw);
  d += 0.5*aaBand(km, 47627.0, 2.0, fw);
  d += 0.5*aaBand(km, 48300.0, 4.0, fw);
  d += 0.25*aaBand(km, 50024.0, 2.0, fw);
  d += 0.8*aaBand(km, 51149.0, 30.0, fw);
  return clamp(d*3.0, 0.0, 1.0);
}`;

  const PLANET_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPosV; varying vec3 vNrmV; varying vec3 vPosL;
void main(){
  vPosL = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosV = mv.xyz;
  vNrmV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

  const SHADOW_FN = /* glsl */`
uniform vec4 uOcc[4]; uniform int uOccN; uniform float uSunAng; uniform vec3 uSunDirV;
// fraction of the Sun's disc left visible from point P (receiver radii), real geometry
float occlusion(vec3 P, vec3 L){
  float vis = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccN) break;
    vec3 C = uOcc[i].xyz - P;
    float dist = length(C);
    vec3 Cn = C / dist;
    if (dot(Cn, L) <= 0.0) continue;
    float aO = asin(min(uOcc[i].w / dist, 1.0));
    float sep = atan(length(cross(Cn, L)), dot(Cn, L));
    float aS = uSunAng;
    float full = min(aO*aO/(aS*aS), 1.0);
    float cover = 0.0;
    if (sep < abs(aS - aO)) cover = full;
    else if (sep < aS + aO) cover = full * smoothstep(0.0, 1.0, (aS + aO - sep)/(2.0*min(aS, aO)));
    vis *= 1.0 - cover;
  }
  return vis;
}`;

  const PLANET_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform vec3 uSunV; uniform vec3 uCenterV;
uniform vec3 uAtmo; uniform float uAtmoK; uniform float uWrap;
uniform float uBump; uniform float uSpec; uniform float uAmbient; uniform vec3 uUmbra;
uniform int uRingOn; uniform vec3 uSunDirL; uniform float uFlat;
uniform float uCloud; uniform float uOpacity; uniform float uEmis;
varying vec3 vPosV; varying vec3 vNrmV; varying vec3 vPosL;
${RING_FN}
${SHADOW_FN}
void main(){
  #include <logdepthbuf_fragment>
  vec3 dl = normalize(vPosL);
  float phi = atan(dl.z, -dl.x);
  float uA = fract(phi / PI2);
  float uB = fract(phi / PI2 + 0.5) - 0.5;
  float v = 0.5 + asin(clamp(dl.y, -1.0, 1.0)) / PI;
  vec2 dx = vec2(dFdx(uA), dFdx(v)), dy = vec2(dFdy(uA), dFdy(v));
  float dxB = dFdx(uB), dyB = dFdy(uB);
  if (abs(dx.x) > abs(dxB)) dx.x = dxB;
  if (abs(dy.x) > abs(dyB)) dy.x = dyB;
  vec2 uv = vec2(uA, v);
  vec4 tex = textureGrad(map, uv, dx, dy);
  vec3 Ng = normalize(vNrmV);
  vec3 N = Ng;
  if (uBump > 0.0) {
    float hx = textureGrad(map, uv + dx, dx, dy).a - tex.a;
    float hy = textureGrad(map, uv + dy, dx, dy).a - tex.a;
    vec3 sx = dFdx(vPosV), sy = dFdy(vPosV);
    vec3 r1 = cross(sy, Ng), r2 = cross(Ng, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (hx*uBump*r1 + hy*uBump*r2);
    N = normalize(abs(det)*Ng - grad);
  }
  vec3 L = normalize(uSunV - vPosV);
  vec3 V = normalize(-vPosV);
  float NgL = dot(Ng, L);
  float lit = clamp((NgL + uWrap) / (1.0 + uWrap), 0.0, 1.0);
  float NL = dot(N, L);
  float bumpTerm = clamp(NL / max(NgL, 0.04), 0.35, 1.7);
  float diff = lit * mix(1.0, bumpTerm, smoothstep(0.02, 0.3, NgL));
  vec3 P = (vPosV - uCenterV);
  float pr = length(P);
  float sh = occlusion(P / max(pr, 1e-20), uSunDirV);
  if (uRingOn == 1) {
    vec3 Pl = vec3(dl.x, dl.y*(1.0 - uFlat), dl.z);
    vec3 Ld = uSunDirL;
    if (Ld.y * Pl.y < 0.0) {
      float t = -Pl.y / Ld.y;
      vec3 hit = Pl + Ld*t;
      sh *= 1.0 - saturnRing(length(hit.xz), 400.0)*0.9;
    }
  }
  vec3 light = vec3(diff) * (sh + (1.0 - sh)*uUmbra);
  vec3 albedo = uCloud > 0.5 ? vec3(1.0) : pow(tex.rgb, vec3(2.2));
  vec3 col = albedo * (light + uAmbient);
  if (uSpec > 0.0) {
    float ocean = 1.0 - smoothstep(0.0, 0.03, tex.a);
    vec3 H = normalize(L + V);
    float nh = max(dot(Ng, H), 0.0);
    col += ocean * uSpec * (pow(nh, 500.0)*0.45 + pow(nh, 60.0)*0.022) * vec3(1.0, 0.93, 0.82) * sh * smoothstep(0.0, 0.1, NgL);
  }
  float fres = pow(1.0 - max(dot(Ng, V), 0.0), 3.0);
  col += uAtmo * uAtmoK * fres * smoothstep(-0.2, 0.5, NgL) * (0.3 + 0.7*sh);
  col += albedo * uEmis;
  float alpha = uCloud > 0.5 ? tex.r * uOpacity : 1.0;
  gl_FragColor = vec4(col, alpha);
}`;

  const ATMO_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunV; uniform vec3 uCenterV; uniform float uR; uniform float uH; uniform float uShell;
uniform vec3 uColor; uniform float uK; uniform float uTint;
varying vec3 vPosV; varying vec3 vNrmV; varying vec3 vPosL;
void main(){
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vPosV);
  float t = dot(uCenterV, dir);
  vec3 cp = dir * max(t, 0.0);
  vec3 rel = cp - uCenterV;
  float h = length(rel);
  float alt = (h - uR) / (uR*uH);
  float dens = exp(-max(alt, 0.0)*1.6);
  vec3 n = rel / max(h, 1e-20);
  vec3 L = normalize(uSunV - uCenterV);
  float mu = dot(n, L);
  float day = smoothstep(-0.35, 0.4, mu);
  float fwd = pow(max(dot(dir, L), 0.0), 10.0) * smoothstep(-0.2, 0.1, -mu + 0.3);
  vec3 tint = mix(vec3(1.0), mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.35, mu)), uTint);
  vec3 col = uColor * tint * dens * (day + fwd*1.5) * uK;
  float edge = 1.0 - smoothstep(uR, uShell, h);
  gl_FragColor = vec4(col * edge, 1.0);
}`;

  const RING_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDirL; uniform vec3 uCamL; uniform float uFlat; uniform int uKind; uniform float uKmPerUnit;
varying vec3 vPosV; varying vec3 vNrmV; varying vec3 vPosL;
${RING_FN}
void main(){
  #include <logdepthbuf_fragment>
  vec3 P = vec3(vPosL.x, 0.0, vPosL.z);
  float r = length(P.xz);
  float fw = fwidth(r) * uKmPerUnit;
  float dens = uKind == 0 ? saturnRing(r, fw) : uranusRing(r, fw);
  if (dens < 0.004) discard;
  vec3 base = uKind == 0 ? saturnRingColor(r) : vec3(0.5,0.5,0.52);
  vec3 D = uSunDirL;
  vec3 Ps = vec3(P.x, P.y/(1.0-uFlat), P.z), Ds = vec3(D.x, D.y/(1.0-uFlat), D.z);
  float a = dot(Ds,Ds), b = dot(Ps,Ds);
  float m = sqrt(max(dot(Ps,Ps) - b*b/a, 0.0));
  float shadow = b < 0.0 ? smoothstep(0.985, 1.015, m) : 1.0;
  vec3 V = normalize(uCamL - P);
  float mu0 = abs(D.y);
  float litSide = step(0.0, D.y * V.y);
  float front = 0.25 + 0.75*pow(mu0, 0.35);
  float back = (1.0 - dens) * 0.9 * pow(mu0, 0.25) + 0.04;
  float bright = mix(back, front, litSide);
  vec3 col = pow(base, vec3(2.2)) * bright * shadow + pow(base, vec3(2.2))*0.015;
  gl_FragColor = vec4(col, uKind == 0 ? dens : dens*0.7);
}`;

  const SUN_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
varying vec3 vPosV; varying vec3 vNrmV; varying vec3 vPosL;
#define LOOP_ZERO 0
${NOISE_TEX}
void main(){
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vPosL);
  float t = uTime;
  float g1 = snoise(p*26.0 + vec3(0.0, t*0.05, 0.0));
  float g2 = snoise(p*64.0 + vec3(t*0.08, 0.0, 0.0));
  float sg = snoise(p*7.0 + vec3(0.0, 0.0, t*0.012));
  float gran = 0.5 + 0.32*g1 + 0.2*g2 + 0.26*sg;
  float lat = asin(p.y);
  float band = smoothstep(0.08, 0.16, abs(lat)) * (1.0 - smoothstep(0.5, 0.64, abs(lat)));
  float sn = snoise(p*4.5 + vec3(t*0.0015, 0.0, 0.0)) + 0.35*snoise(p*11.0);
  float spot = smoothstep(0.9, 0.97, sn) * band;
  float pen = smoothstep(0.8, 0.9, sn) * band;
  vec3 N = normalize(vNrmV); vec3 V = normalize(-vPosV);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  float limb = pow(mu, 0.5);
  vec3 hot = vec3(1.0, 0.8, 0.45), warm = vec3(1.0, 0.5, 0.12), cool = vec3(0.85, 0.22, 0.03);
  vec3 col = mix(warm, hot, clamp(gran, 0.0, 1.0));
  col = mix(cool, col, smoothstep(0.0, 0.85, limb));
  col *= mix(0.42, 1.0, limb);
  float fac = smoothstep(0.55, 0.8, snoise(p*18.0 + t*0.01)) * (1.0 - limb) * 0.4;
  col *= 1.0 + fac;
  col *= 1.0 - pen*0.32 - spot*0.55;
  gl_FragColor = vec4(col * 1.05, 1.0);
}`;

  const CORONA_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
  const CORONA_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime; uniform float uSunQ; uniform float uFade; uniform float uStar;
varying vec2 vUv;
#define LOOP_ZERO 0
${NOISE_TEX}
void main(){
  #include <logdepthbuf_fragment>
  vec2 q = (vUv - 0.5) * 2.0;
  float rq = length(q);
  float r = rq / uSunQ;
  float a = atan(q.y, q.x);
  float glow = 1.0 / pow(max(r, 1.0), 3.0);
  float n = snoise(vec3(cos(a)*2.2, sin(a)*2.2, uTime*0.015 + log(max(r,1.0))*0.35));
  float n2 = snoise(vec3(cos(a)*7.0, sin(a)*7.0, uTime*0.02 + log(max(r,1.0))*0.9));
  float streamer = pow(0.5 + 0.5*n, 3.0) * (0.6 + 0.4*n2) * exp(-(r - 1.0)*0.55);
  float inner = exp(-(r - 1.0)*7.0);
  vec3 col = vec3(1.0, 0.6, 0.28) * glow * 0.16 + vec3(1.0, 0.72, 0.45) * streamer * 0.12 + vec3(1.0, 0.8, 0.55) * inner * 0.45;
  col += vec3(1.0, 0.88, 0.7) * (exp(-rq*rq*260.0)*2.2 + exp(-rq*rq*30.0)*0.25) * uStar;
  col *= 1.0 - smoothstep(0.55, 1.0, rq);
  gl_FragColor = vec4(col * uFade, 1.0);
}`;

  const STAR_VERT = /* glsl */`
attribute float aSize; attribute vec3 aColor;
uniform float uPix;
varying vec3 vColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPix;
  vColor = aColor;
}`;
  const STAR_FRAG = /* glsl */`
varying vec3 vColor;
uniform float uK;
void main(){
  vec2 c = gl_PointCoord*2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2*6.0) + 0.12*exp(-r2*1.5);
  gl_FragColor = vec4(vColor * a * uK, 1.0);
}`;

  const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const SKY_FRAG = /* glsl */`
uniform vec3 uGN; uniform vec3 uGC; uniform float uK;
varying vec3 vDir;
#define LOOP_ZERO 0
${NOISE_TEX}
void main(){
  vec3 d = normalize(vDir);
  float b = asin(clamp(dot(d, uGN), -1.0, 1.0));
  vec3 gy = cross(uGN, uGC);
  float l = atan(dot(d, gy), dot(d, uGC));
  float toward = smoothstep(2.6, 0.0, abs(l));
  float width = 0.11 + 0.10*toward;
  float band = exp(-pow(b/width, 2.0));
  float bulge = exp(-pow(l/0.42, 2.0) - pow(b/0.2, 2.0));
  float n = fbm(d*5.0, 4)*0.5 + 0.5;
  float clumps = fbm(d*13.0 + 3.0, 3)*0.5 + 0.5;
  float dust = smoothstep(0.42, 0.72, fbm(d*7.0 + 7.0, 4)*0.5 + 0.5) * exp(-pow((b - 0.01)/0.06, 2.0)) * (0.4 + 0.6*toward);
  float I = band*(0.35 + 0.65*n)*(0.55 + 0.7*clumps)*(0.45 + 0.75*toward) + bulge*1.1;
  I *= 1.0 - dust*0.85;
  I += exp(-pow(b/0.55, 2.0))*0.06;
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.84, 0.66), clamp(bulge*1.4 + 0.35*toward, 0.0, 1.0));
  gl_FragColor = vec4(col * I * uK, 1.0);
}`;

  const ORBIT_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aPhase;
varying float vPhase; varying vec3 vView;
void main(){
  vPhase = aPhase;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
  const ORBIT_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uPhase; uniform float uOpacity; uniform vec3 uBodyV; uniform float uBodyR; uniform float uDir;
varying float vPhase; varying vec3 vView;
void main(){
  #include <logdepthbuf_fragment>
  float d = fract((uPhase - vPhase) * uDir);
  float trail = pow(1.0 - d, 5.0);
  float a = uOpacity * (0.16 + 0.84*trail);
  a *= smoothstep(uBodyR*1.3, uBodyR*5.0, distance(vView, uBodyV));
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

  const BELT_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aEl; attribute vec4 aEl2;
uniform float uDays; uniform float uMix; uniform float uPix; uniform float uLamJ;
varying float vA;
float mapR(float r){ return exp(mix(log(40.0*pow(r, 0.62)), log(40.0*r), uMix)); }
void main(){
  float a = aEl.x, e = aEl.y, inc = aEl.z, O = aEl.w, w = aEl2.x;
  float M = aEl2.y + aEl2.z*uDays + aEl2.w*uLamJ;
  M = mod(M, 6.28318530718);
  float E = M + e*sin(M);
  for (int k = 0; k < 4; k++) E = E - (E - e*sin(E) - M)/(1.0 - e*cos(E));
  float xp = a*(cos(E) - e), yp = a*sqrt(1.0 - e*e)*sin(E);
  float cw = cos(w), sw = sin(w), cO = cos(O), sO = sin(O), ci = cos(inc), si = sin(inc);
  float x = (cw*cO - sw*sO*ci)*xp + (-sw*cO - cw*sO*ci)*yp;
  float y = (cw*sO + sw*cO*ci)*xp + (-sw*sO + cw*cO*ci)*yp;
  float z = (sw*si)*xp + (cw*si)*yp;
  vec3 p = vec3(x, z, -y);
  float r = length(p);
  p *= mapR(r) / r;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPix;
  vA = 1.0;
  #include <logdepthbuf_vertex>
}`;
  const BELT_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main(){
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord*2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(uColor * uOpacity * (1.0 - r2), 1.0);
}`;

  const TAIL_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vT; varying vec3 vN; varying vec3 vV;
void main(){
  vT = -position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
  const TAIL_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uAct;
varying float vT; varying vec3 vN; varying vec3 vV;
void main(){
  #include <logdepthbuf_fragment>
  float t = clamp(vT, 0.0, 1.0);
  float along = pow(1.0 - t, 1.7) * smoothstep(0.0, 0.05, t);
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
  gl_FragColor = vec4(uColor * along * edge * uAct, 1.0);
}`;
  const COMA_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uAct;
varying vec2 vUv;
void main(){
  #include <logdepthbuf_fragment>
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float a = exp(-r*r*7.0)*0.8 + exp(-r*r*60.0)*0.9;
  gl_FragColor = vec4(uColor * a * uAct * (1.0 - smoothstep(0.75, 1.0, r)), 1.0);
}`;

  return {
    TAIL_VERT, TAIL_FRAG, COMA_FRAG,
    BAKE_VERT, BAKE_HEAD, BAKE_MAIN, SURF: S,
    PLANET_VERT, PLANET_FRAG, ATMO_FRAG, RING_FRAG, SUN_FRAG,
    CORONA_VERT, CORONA_FRAG, STAR_VERT, STAR_FRAG, SKY_VERT, SKY_FRAG,
    ORBIT_VERT, ORBIT_FRAG, BELT_VERT, BELT_FRAG,
  };
})();
