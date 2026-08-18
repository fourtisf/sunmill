// @ts-nocheck
/* SUNMILL — procedural art engine. Pure canvas2d, no assets.
 *
 * Ported VERBATIM from the prototype's art.js. This file is the product's
 * visual identity — do not edit it (CLAUDE.md golden rule 2). The only change
 * from the prototype is the module wrapper: the IIFE that assigned to
 * `window.ART` became an ES export. Every sprite function is byte-identical.
 */


/* ============ helpers ============ */
function lg(c,x0,y0,x1,y1,st){const g=c.createLinearGradient(x0,y0,x1,y1);for(const s of st)g.addColorStop(s[0],s[1]);return g}
function rg(c,x,y,r0,r1,st){const g=c.createRadialGradient(x,y,r0,x,y,r1);for(const s of st)g.addColorStop(s[0],s[1]);return g}
function ell(c,x,y,rx,ry,rot){c.beginPath();c.ellipse(x,y,Math.max(.01,rx),Math.max(.01,ry),rot||0,0,6.2832)}
function rr(c,x,y,w,h,r){const m=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+m,y);c.arcTo(x+w,y,x+w,y+h,m);c.arcTo(x+w,y+h,x,y+h,m);c.arcTo(x,y+h,x,y,m);c.arcTo(x,y,x+w,y,m);c.closePath()}
function poly(c,pts){c.beginPath();c.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)c.lineTo(pts[i][0],pts[i][1]);c.closePath()}
function contact(c,x,y,rx,ry,a){c.save();c.globalAlpha=a==null?.32:a;c.fillStyle=rg(c,x,y,0,Math.max(rx,ry),[[0,'rgba(24,40,12,.95)'],[.55,'rgba(24,40,12,.42)'],[1,'rgba(24,40,12,0)']]);ell(c,x,y,rx,ry);c.fill();c.restore()}
function ink(c,w,a){c.strokeStyle='rgba(62,36,12,'+(a==null?.42:a)+')';c.lineWidth=w==null?1.6:w;c.lineJoin='round';c.lineCap='round';c.stroke()}
function gloss(c,x,y,rx,ry,a){c.save();c.globalAlpha=a==null?.5:a;c.fillStyle='#fff';ell(c,x,y,rx,ry,-.5);c.fill();c.restore()}
function hx(h){
  if(h.charAt(0)==='r'){const m=h.match(/-?\d+/g);return[+m[0],+m[1],+m[2]]}
  h=h.replace('#','');
  if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
function mix(a,b,t){const A=hx(a),B=hx(b);return'rgb('+Math.round(A[0]+(B[0]-A[0])*t)+','+Math.round(A[1]+(B[1]-A[1])*t)+','+Math.round(A[2]+(B[2]-A[2])*t)+')'}
function prng(s){let t=(s|0)+0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}

/* ============ item icons ============
   Every icon draws inside a 64x64 box, ground-ish centred. */
const I={};

I.coin=function(c){
  contact(c,32,54,15,4.5,.3);
  c.fillStyle=lg(c,18,14,46,52,[[0,'#FFE9A8'],[.42,'#FFD24A'],[1,'#C98A12']]);
  ell(c,32,32,21,21);c.fill();ink(c,2.4,.45);
  c.fillStyle=lg(c,20,16,44,48,[[0,'#FFF3CC'],[1,'#F0B72E']]);
  ell(c,32,32,15.5,15.5);c.fill();
  c.save();c.globalAlpha=.55;c.fillStyle='#fff';ell(c,26,24,8,5,-.65);c.fill();c.restore();
  c.fillStyle='#B8790C';c.beginPath();
  for(let i=0;i<10;i++){const a=-1.5708+i*0.6283,r=i%2?4.2:9.4;const x=32+Math.cos(a)*r,y=32+Math.sin(a)*r;i?c.lineTo(x,y):c.moveTo(x,y)}
  c.closePath();c.fill();
  c.save();c.globalAlpha=.5;c.strokeStyle='#8A5A05';c.lineWidth=1.2;ell(c,32,32,15.5,15.5);c.stroke();c.restore();
};

I.hay=function(c){
  contact(c,32,54,15,4.5,.3);
  c.fillStyle=lg(c,16,12,48,52,[[0,'#D4AFFF'],[.45,'#9B5CF0'],[1,'#5B21A8']]);
  c.beginPath();for(let i=0;i<6;i++){const a=-1.5708+i*1.0472,x=32+Math.cos(a)*21,y=32+Math.sin(a)*21;i?c.lineTo(x,y):c.moveTo(x,y)}c.closePath();c.fill();
  ink(c,2.4,.35);
  c.fillStyle=lg(c,20,16,44,48,[[0,'#C79BFF'],[1,'#7B3BD4']]);
  c.beginPath();for(let i=0;i<6;i++){const a=-1.5708+i*1.0472,x=32+Math.cos(a)*15.5,y=32+Math.sin(a)*15.5;i?c.lineTo(x,y):c.moveTo(x,y)}c.closePath();c.fill();
  c.save();c.globalAlpha=.4;c.fillStyle='#fff';ell(c,26,23,7.5,4.5,-.6);c.fill();c.restore();
  c.strokeStyle='#FFE9A8';c.lineWidth=2.6;c.lineCap='round';
  c.beginPath();c.moveTo(32,41);c.lineTo(32,24);c.stroke();
  for(let s=0;s<3;s++){const y=27+s*5;
    c.beginPath();c.moveTo(32,y+2.5);c.quadraticCurveTo(26.5,y+1,25,y-2.5);c.stroke();
    c.beginPath();c.moveTo(32,y+2.5);c.quadraticCurveTo(37.5,y+1,39,y-2.5);c.stroke();}
};

I.wheat=function(c){
  contact(c,32,55,14,4,.26);
  const stalk=[[32,-2,0],[21,4,-.22],[43,4,.22]];
  for(const s of stalk){
    c.save();c.translate(s[0],54);c.rotate(s[2]);
    c.strokeStyle='#8FA83C';c.lineWidth=2.6;c.lineCap='round';
    c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(1,-16,0,-30-s[1]);c.stroke();
    const H=30+s[1];
    for(let i=0;i<5;i++){
      const y=-H-4+i*5.4;
      for(const d of[-1,1]){
        c.fillStyle=lg(c,-6*d,y-4,6*d,y+4,[[0,'#FFE08A'],[.5,'#F0B93C'],[1,'#C88512']]);
        ell(c,d*4.4,y,4.6,3.1,d*0.62);c.fill();
        c.save();c.globalAlpha=.4;c.fillStyle='#FFF6D0';ell(c,d*3.4,y-1.4,2.1,1.2,d*.62);c.fill();c.restore();
      }
    }
    c.fillStyle='#F5CE63';ell(c,0,-H-9,3.1,5.4);c.fill();
    c.strokeStyle='#E0A81E';c.lineWidth=1.5;
    c.beginPath();c.moveTo(0,-H-13);c.lineTo(-2.5,-H-21);c.moveTo(0,-H-13);c.lineTo(0,-H-22);c.moveTo(0,-H-13);c.lineTo(2.5,-H-21);c.stroke();
    c.restore();
  }
};

I.corn=function(c){
  contact(c,32,55,13,4,.26);
  c.save();c.translate(32,52);
  c.fillStyle=lg(c,-14,-30,10,4,[[0,'#A8D64A'],[1,'#4E8A1E']]);
  c.beginPath();c.moveTo(-3,0);c.quadraticCurveTo(-20,-14,-14,-34);c.quadraticCurveTo(-6,-22,-1,-6);c.closePath();c.fill();ink(c,1.5,.28);
  c.fillStyle=lg(c,14,-30,-10,4,[[0,'#8FC63E'],[1,'#3F7818']]);
  c.beginPath();c.moveTo(3,0);c.quadraticCurveTo(21,-16,16,-37);c.quadraticCurveTo(7,-24,1,-6);c.closePath();c.fill();ink(c,1.5,.28);
  c.fillStyle=lg(c,-8,-44,9,-2,[[0,'#FFE070'],[.45,'#F5C22B'],[1,'#C9860B']]);
  c.beginPath();c.moveTo(0,-2);c.quadraticCurveTo(-9,-10,-8.6,-27);c.quadraticCurveTo(-8,-45,0,-47);c.quadraticCurveTo(8,-45,8.6,-27);c.quadraticCurveTo(9,-10,0,-2);c.closePath();c.fill();ink(c,2,.36);
  c.save();c.clip();
  c.fillStyle='rgba(255,255,255,.32)';
  for(let r=0;r<8;r++)for(let k=0;k<4;k++){const x=-6.4+k*4.2+(r%2?2.1:0),y=-42+r*5.2;ell(c,x,y,1.7,1.9);c.fill()}
  c.fillStyle='rgba(150,86,4,.28)';
  for(let r=0;r<8;r++){c.fillRect(-9,-42+r*5.2+2.2,18,.9)}
  c.restore();
  c.save();c.globalAlpha=.4;c.fillStyle='#FFF8DC';ell(c,-3.4,-33,2.6,9,.12);c.fill();c.restore();
  c.strokeStyle='#D9A23A';c.lineWidth=1.6;c.lineCap='round';
  for(let i=-2;i<=2;i++){c.beginPath();c.moveTo(i*1.4,-46);c.quadraticCurveTo(i*3.4,-53,i*4.6,-56);c.stroke()}
  c.restore();
};

I.carrot=function(c){
  contact(c,32,55,12,3.8,.26);
  c.save();c.translate(32,50);
  c.strokeStyle='#3F7818';c.lineWidth=2;c.lineCap='round';
  const fr=[[-.55,-24],[-.2,-30],[.2,-30],[.55,-24]];
  for(const f of fr){
    c.save();c.rotate(f[0]);
    c.strokeStyle='#4E8A1E';c.lineWidth=2.2;
    c.beginPath();c.moveTo(0,-16);c.quadraticCurveTo(0,f[1]/2,0,f[1]);c.stroke();
    c.fillStyle=lg(c,-4,f[1],4,-14,[[0,'#A8D64A'],[1,'#3F7818']]);
    for(let i=0;i<4;i++){const y=f[1]+3+i*5.2;
      ell(c,-3.2,y,3.4,2.2,-.5);c.fill();ell(c,3.2,y,3.4,2.2,.5);c.fill();}
    c.restore();
  }
  c.fillStyle=lg(c,-9,-16,9,4,[[0,'#FFA94D'],[.45,'#F27A1A'],[1,'#B84A05']]);
  c.beginPath();c.moveTo(-8.5,-15);c.quadraticCurveTo(-9.5,-4,0,2);c.quadraticCurveTo(9.5,-4,8.5,-15);c.quadraticCurveTo(0,-19,-8.5,-15);c.closePath();c.fill();ink(c,2,.36);
  c.save();c.clip();c.strokeStyle='rgba(160,60,0,.35)';c.lineWidth=1.4;
  for(let i=0;i<4;i++){const y=-13+i*4;c.beginPath();c.moveTo(-9,y);c.quadraticCurveTo(0,y+3,9,y);c.stroke()}
  c.restore();
  c.save();c.globalAlpha=.45;c.fillStyle='#FFD9A8';ell(c,-3.6,-9,2.4,5,.2);c.fill();c.restore();
  c.restore();
};

I.soybean=function(c){
  contact(c,32,55,13,4,.26);
  c.save();c.translate(32,52);
  c.fillStyle=lg(c,-12,-26,6,-4,[[0,'#8FC63E'],[1,'#3F7818']]);
  ell(c,-11,-20,8.5,6.4,-.45);c.fill();ink(c,1.5,.3);
  ell(c,11,-24,8,6,.4);c.fill();ink(c,1.5,.3);
  c.strokeStyle='#2F5E12';c.lineWidth=1.2;
  c.beginPath();c.moveTo(-17,-17);c.lineTo(-5,-23);c.moveTo(5,-27);c.lineTo(17,-21);c.stroke();
  for(const s of[[-1,-2,-.35],[1,2,.3]]){
    c.save();c.translate(s[0]*6,-4+s[1]);c.rotate(s[2]);
    c.fillStyle=lg(c,-5,-14,5,6,[[0,'#CFE86B'],[.5,'#9DC93A'],[1,'#5E9420']]);
    c.beginPath();c.moveTo(0,8);c.quadraticCurveTo(-6.4,2,-5.6,-8);c.quadraticCurveTo(-4.6,-17,0,-18);c.quadraticCurveTo(4.6,-17,5.6,-8);c.quadraticCurveTo(6.4,2,0,8);c.closePath();c.fill();ink(c,1.8,.34);
    c.save();c.globalAlpha=.35;c.fillStyle='#4E8A1E';
    for(let i=0;i<3;i++)ell(c,0,-13+i*7.5,3.7,3.3),c.fill();
    c.restore();
    c.save();c.globalAlpha=.42;c.fillStyle='#F0FBC0';ell(c,-2.2,-9,1.7,5.4,.1);c.fill();c.restore();
    c.restore();
  }
  c.restore();
};

I.sugarcane=function(c){
  contact(c,32,55,13,4,.26);
  const st=[[26,-.13,40],[32,0,47],[38,.13,42]];
  for(const s of st){
    c.save();c.translate(s[0],54);c.rotate(s[1]);
    const H=s[2];
    c.fillStyle=lg(c,-4,-H,4,0,[[0,'#D8E88A'],[.4,'#A8C64E'],[1,'#6A9022']]);
    rr(c,-3.6,-H,7.2,H,3.2);c.fill();ink(c,1.6,.32);
    c.strokeStyle='rgba(70,100,20,.5)';c.lineWidth=1.4;
    for(let i=1;i*9<H;i++){c.beginPath();c.moveTo(-3.6,-i*9);c.lineTo(3.6,-i*9);c.stroke()}
    c.save();c.globalAlpha=.4;c.fillStyle='#F2FBC8';rr(c,-2.6,-H+3,1.7,H-7,1);c.fill();c.restore();
    c.fillStyle=lg(c,-8,-H-14,8,-H,[[0,'#B6DC52'],[1,'#4E8A1E']]);
    for(const d of[-1,1]){c.beginPath();c.moveTo(0,-H+1);c.quadraticCurveTo(d*9,-H-6,d*4,-H-15);c.quadraticCurveTo(d*2,-H-6,0,-H+1);c.closePath();c.fill()}
    c.restore();
  }
};

I.egg=function(c){
  contact(c,32,54,13,4,.28);
  c.fillStyle=lg(c,22,16,42,50,[[0,'#FFFDF6'],[.5,'#F7E9CF'],[1,'#D9BC90']]);
  c.beginPath();c.moveTo(32,10);c.bezierCurveTo(46,18,48,36,44,44);c.bezierCurveTo(40,52,24,52,20,44);c.bezierCurveTo(16,36,18,18,32,10);c.closePath();c.fill();ink(c,2,.34);
  c.save();c.globalAlpha=.75;c.fillStyle='#fff';ell(c,26,24,5,8,-.4);c.fill();c.restore();
  c.save();c.globalAlpha=.2;c.fillStyle='#9C7A44';
  const sp=[[36,20,2],[38,32,1.6],[27,38,1.9],[34,44,1.4],[24,29,1.4]];
  for(const s of sp){ell(c,s[0],s[1],s[2],s[2]*.85);c.fill()}
  c.restore();
};

I.milk=function(c){
  contact(c,32,55,14,4,.28);
  c.fillStyle=lg(c,20,18,44,52,[[0,'#EAF6FF'],[.45,'#CFE6F5'],[1,'#8FB4CC']]);
  c.beginPath();c.moveTo(26,14);c.lineTo(38,14);c.lineTo(40,24);c.quadraticCurveTo(48,30,48,42);c.quadraticCurveTo(48,53,32,53);c.quadraticCurveTo(16,53,16,42);c.quadraticCurveTo(16,30,24,24);c.closePath();c.fill();ink(c,2.1,.36);
  c.save();c.beginPath();c.moveTo(26,15);c.lineTo(38,15);c.lineTo(40,24);c.quadraticCurveTo(47,30,47,42);c.quadraticCurveTo(47,52,32,52);c.quadraticCurveTo(17,52,17,42);c.quadraticCurveTo(17,30,24,24);c.closePath();c.clip();
  c.fillStyle=lg(c,18,30,46,52,[[0,'#FFFFFF'],[1,'#E4EFF6']]);c.fillRect(14,30,36,24);
  c.fillStyle='rgba(255,255,255,.9)';ell(c,32,30.5,15,3.4);c.fill();
  c.restore();
  c.fillStyle=lg(c,26,10,38,18,[[0,'#7FCBEA'],[1,'#2E86B8']]);rr(c,24.5,9,15,7,3);c.fill();ink(c,1.8,.3);
  c.save();c.globalAlpha=.62;c.fillStyle='#fff';rr(c,21.5,32,4.6,15,2.3);c.fill();c.restore();
};

I.wool=function(c){
  contact(c,32,54,15,4.5,.28);
  c.fillStyle=lg(c,18,14,46,50,[[0,'#FFFFFF'],[.5,'#F2EFE6'],[1,'#CFC7B4']]);
  c.beginPath();
  const N=11;for(let i=0;i<N;i++){const a=i/N*6.2832,r=19.5;const x=32+Math.cos(a)*r,y=33+Math.sin(a)*r*.94;
    const a2=(i+.5)/N*6.2832,x2=32+Math.cos(a2)*(r+5.4),y2=33+Math.sin(a2)*((r+5.4)*.94);
    i?c.quadraticCurveTo(x2,y2,x,y):c.moveTo(x,y)}
  c.closePath();c.fill();ink(c,2,.28);
  c.save();c.globalAlpha=.35;c.strokeStyle='#B8AE98';c.lineWidth=1.8;c.lineCap='round';
  for(const s of[[24,26,6],[38,24,5],[30,38,6.5],[41,38,4.6],[20,36,4.4]]){
    c.beginPath();c.arc(s[0],s[1],s[2],.6,4.4);c.stroke()}
  c.restore();
  c.save();c.globalAlpha=.7;c.fillStyle='#fff';ell(c,24,22,7,4.6,-.5);c.fill();c.restore();
};

function sack(c,tint,dark,glyph){
  contact(c,32,55,14,4.2,.3);
  c.fillStyle=lg(c,18,18,46,54,[[0,tint],[.5,mix(tint,dark,.45)],[1,dark]]);
  c.beginPath();c.moveTo(21,22);c.quadraticCurveTo(14,38,17,50);c.quadraticCurveTo(19,55,32,55);c.quadraticCurveTo(45,55,47,50);c.quadraticCurveTo(50,38,43,22);c.closePath();c.fill();ink(c,2.1,.4);
  c.fillStyle=mix(tint,'#ffffff',.25);
  c.beginPath();c.moveTo(21,22);c.quadraticCurveTo(32,17,43,22);c.quadraticCurveTo(38,27,32,26);c.quadraticCurveTo(26,27,21,22);c.closePath();c.fill();ink(c,1.6,.32);
  c.strokeStyle=mix(dark,'#000000',.25);c.lineWidth=2.4;c.lineCap='round';
  c.beginPath();c.moveTo(22,24);c.quadraticCurveTo(32,29,42,24);c.stroke();
  c.save();c.globalAlpha=.3;c.fillStyle='#fff';
  c.beginPath();c.moveTo(23,26);c.quadraticCurveTo(19,38,21,50);c.quadraticCurveTo(25,40,27,27);c.closePath();c.fill();c.restore();
  c.save();c.translate(32,40);glyph(c);c.restore();
}
I.cfeed=function(c){sack(c,'#E8C98A','#A8792E',function(g){
  g.fillStyle='rgba(90,54,10,.5)';
  for(let i=0;i<7;i++){const a=i/7*6.2832;ell(g,Math.cos(a)*6.4,Math.sin(a)*5.4,2.5,2);g.fill()}
  ell(g,0,0,2.7,2.2);g.fill();})};
I.vfeed=function(c){sack(c,'#CFE38A','#5E8A22',function(g){
  g.fillStyle='rgba(40,70,10,.45)';
  for(const s of[[-6,-3,.5],[0,-6,0],[6,-2,-.5],[-3,4,.3],[4,4,-.3]]){
    g.save();g.translate(s[0],s[1]);g.rotate(s[2]);ell(g,0,0,2,5.4);g.fill();g.restore()}})};
I.sfeed=function(c){sack(c,'#BBD9EE','#3A79A8',function(g){
  g.fillStyle='rgba(15,50,80,.4)';
  for(const s of[[-5,-2],[5,-2],[0,4]]){ell(g,s[0],s[1],4.6,3.6);g.fill()}
  g.fillStyle='rgba(255,255,255,.55)';for(const s of[[-6,-3],[4,-3],[-1,3]]){ell(g,s[0],s[1],1.9,1.5);g.fill()}})};

I.bread=function(c){
  contact(c,32,53,16,4.4,.3);
  c.fillStyle=lg(c,16,18,48,50,[[0,'#F0C271'],[.42,'#D99942'],[1,'#96591B']]);
  c.beginPath();c.moveTo(12,46);c.quadraticCurveTo(9,26,22,19);c.quadraticCurveTo(32,13,42,19);c.quadraticCurveTo(55,26,52,46);c.quadraticCurveTo(46,52,32,52);c.quadraticCurveTo(18,52,12,46);c.closePath();c.fill();ink(c,2.2,.42);
  c.save();c.clip();
  c.strokeStyle='rgba(120,66,14,.55)';c.lineWidth=3;c.lineCap='round';
  for(let i=0;i<3;i++){const x=20+i*12;c.beginPath();c.moveTo(x-4,20+i*1.4);c.lineTo(x+6,30+i*1.4);c.stroke()}
  c.fillStyle='rgba(255,240,200,.5)';
  for(let i=0;i<3;i++){const x=20+i*12;c.beginPath();c.moveTo(x-2.4,19.4+i*1.4);c.lineTo(x+7.6,29.4+i*1.4);c.lineTo(x+5.6,31+i*1.4);c.lineTo(x-4.4,21+i*1.4);c.closePath();c.fill()}
  c.restore();
  c.save();c.globalAlpha=.4;c.fillStyle='#FFEBBE';
  c.beginPath();c.moveTo(16,42);c.quadraticCurveTo(13,26,24,21);c.quadraticCurveTo(19,30,20,44);c.closePath();c.fill();c.restore();
};

I.cake=function(c){
  contact(c,32,54,16,4.4,.3);
  c.fillStyle=lg(c,18,44,46,54,[[0,'#F2F2F2'],[1,'#C6C6C6']]);
  ell(c,32,50,19,5.4);c.fill();ink(c,1.7,.3);
  poly(c,[[16,26],[48,26],[45,49],[19,49]]);
  c.fillStyle=lg(c,16,26,48,49,[[0,'#D9A05A'],[.5,'#B87433'],[1,'#7E4614']]);c.fill();ink(c,2,.4);
  c.save();c.clip();
  c.fillStyle='rgba(255,248,235,.85)';c.fillRect(14,33,36,4.4);c.fillRect(14,41,36,4);
  c.fillStyle='rgba(240,140,30,.6)';
  for(let i=0;i<9;i++){const s=prng(i*13);ell(c,18+s*28,29+prng(i*7)*18,2.2,1.5,s*3);c.fill()}
  c.restore();
  c.fillStyle=lg(c,16,18,48,28,[[0,'#FFFFFF'],[1,'#E8E0D0']]);
  c.beginPath();c.moveTo(15,27);c.quadraticCurveTo(15,20,23,20);c.quadraticCurveTo(32,15,41,20);c.quadraticCurveTo(49,20,49,27);c.quadraticCurveTo(40,30,32,29);c.quadraticCurveTo(24,30,15,27);c.closePath();c.fill();ink(c,2,.32);
  c.save();c.translate(32,17);c.rotate(.25);
  c.fillStyle=lg(c,-5,-5,5,6,[[0,'#FFA94D'],[1,'#D2600C']]);
  c.beginPath();c.moveTo(-4,-5);c.quadraticCurveTo(0,9,4,-5);c.quadraticCurveTo(0,-8,-4,-5);c.closePath();c.fill();ink(c,1.4,.3);
  c.strokeStyle='#4E8A1E';c.lineWidth=1.8;c.lineCap='round';
  c.beginPath();c.moveTo(-1.6,-6);c.lineTo(-4,-12);c.moveTo(0,-6);c.lineTo(0,-13);c.moveTo(1.6,-6);c.lineTo(4,-12);c.stroke();
  c.restore();
};

I.cream=function(c){
  contact(c,32,54,15,4.4,.3);
  c.fillStyle=lg(c,18,26,46,52,[[0,'#EFF4F8'],[.5,'#D3DEE7'],[1,'#93A6B4']]);
  c.beginPath();c.moveTo(15,28);c.lineTo(49,28);c.quadraticCurveTo(47,52,32,52);c.quadraticCurveTo(17,52,15,28);c.closePath();c.fill();ink(c,2.1,.36);
  c.fillStyle=lg(c,15,24,49,32,[[0,'#FFFFFF'],[1,'#D8E2EA']]);
  rr(c,12,23,40,8,4);c.fill();ink(c,1.9,.34);
  c.fillStyle=lg(c,20,8,44,26,[[0,'#FFFFFF'],[1,'#EDE6D8']]);
  c.beginPath();c.moveTo(21,25);c.quadraticCurveTo(20,15,27,14);c.quadraticCurveTo(28,7,34,9);c.quadraticCurveTo(40,4,42,12);c.quadraticCurveTo(46,16,42,25);c.closePath();c.fill();ink(c,1.8,.26);
  c.save();c.globalAlpha=.6;c.fillStyle='#fff';ell(c,28,15,5,3.4,-.5);c.fill();c.restore();
  c.save();c.globalAlpha=.5;c.fillStyle='#fff';rr(c,19,32,4.4,14,2.2);c.fill();c.restore();
};

I.butter=function(c){
  contact(c,32,52,17,4.6,.3);
  poly(c,[[12,44],[52,44],[47,50],[17,50]]);
  c.fillStyle=lg(c,12,44,52,50,[[0,'#F2F2F2'],[1,'#BDBDBD']]);c.fill();ink(c,1.7,.3);
  poly(c,[[16,30],[44,24],[52,30],[24,36]]);
  c.fillStyle=lg(c,16,24,52,36,[[0,'#FFF0A8'],[1,'#F0CB4A']]);c.fill();
  poly(c,[[16,30],[24,36],[24,46],[16,40]]);
  c.fillStyle=lg(c,16,30,24,46,[[0,'#E8B92E'],[1,'#C08F12']]);c.fill();
  poly(c,[[24,36],[52,30],[52,40],[24,46]]);
  c.fillStyle=lg(c,24,36,52,46,[[0,'#F7D558'],[1,'#D9A31C']]);c.fill();
  poly(c,[[16,30],[44,24],[52,30],[24,36]]);ink(c,2,.4);
  poly(c,[[16,30],[24,36],[24,46],[16,40]]);ink(c,2,.4);
  poly(c,[[24,36],[52,30],[52,40],[24,46]]);ink(c,2,.4);
  c.save();c.globalAlpha=.5;c.fillStyle='#FFFBE0';
  poly(c,[[19,30.5],[40,26],[44,29],[24,34]]);c.fill();c.restore();
};

I.sugar=function(c){
  contact(c,32,53,16,4.4,.3);
  function cube(x,y,s){
    poly(c,[[x,y],[x+s,y-s*.5],[x+s*2,y],[x+s,y+s*.5]]);
    c.fillStyle=lg(c,x,y-s,x+s*2,y+s,[[0,'#FFFFFF'],[1,'#E6ECF2']]);c.fill();ink(c,1.6,.28);
    poly(c,[[x,y],[x+s,y+s*.5],[x+s,y+s*1.5],[x,y+s]]);
    c.fillStyle=lg(c,x,y,x+s,y+s*1.5,[[0,'#D9E3EC'],[1,'#AFBFCE']]);c.fill();ink(c,1.6,.28);
    poly(c,[[x+s,y+s*.5],[x+s*2,y],[x+s*2,y+s],[x+s,y+s*1.5]]);
    c.fillStyle=lg(c,x+s,y,x+s*2,y+s*1.5,[[0,'#EDF3F8'],[1,'#C4D2DE']]);c.fill();ink(c,1.6,.28);
  }
  cube(13,38,9);cube(31,38,9);cube(22,25,9);
  c.save();c.globalAlpha=.5;c.fillStyle='#fff';ell(c,29,25,6,2.6,-.15);c.fill();c.restore();
};

I.syrup=function(c){
  contact(c,32,55,12,4,.3);
  c.fillStyle=lg(c,20,20,44,54,[[0,'#F7E3B8'],[.4,'#D99B2E'],[1,'#8A5106']]);
  c.beginPath();c.moveTo(27,14);c.lineTo(37,14);c.lineTo(38,22);c.quadraticCurveTo(46,28,46,42);c.quadraticCurveTo(46,54,32,54);c.quadraticCurveTo(18,54,18,42);c.quadraticCurveTo(18,28,26,22);c.closePath();c.fill();ink(c,2.1,.42);
  c.save();c.beginPath();c.moveTo(27,15);c.lineTo(37,15);c.lineTo(38,22);c.quadraticCurveTo(45,28,45,42);c.quadraticCurveTo(45,53,32,53);c.quadraticCurveTo(19,53,19,42);c.quadraticCurveTo(19,28,26,22);c.closePath();c.clip();
  c.fillStyle=lg(c,18,26,46,53,[[0,'#E8A93A'],[1,'#7A4304']]);c.fillRect(16,26,34,30);
  c.fillStyle='rgba(255,225,160,.5)';ell(c,32,26.5,13,3);c.fill();
  c.restore();
  c.fillStyle=lg(c,26,8,38,16,[[0,'#C4863A'],[1,'#6E3D06']]);rr(c,25,8,14,7,3);c.fill();ink(c,1.7,.32);
  c.save();c.globalAlpha=.5;c.fillStyle='#FFF0CC';rr(c,22.5,31,4.2,15,2.1);c.fill();c.restore();
  c.fillStyle='rgba(255,248,225,.9)';rr(c,22,36,20,10,3);c.fill();
  c.fillStyle='rgba(140,80,10,.75)';ell(c,32,41,6.4,3.2);c.fill();
};


/* ============ export ============ */
export const ART = {lg:lg,rg:rg,ell:ell,rr:rr,poly:poly,contact:contact,ink:ink,gloss:gloss,mix:mix,prng:prng,ICON:I};
export const ICON = I;
