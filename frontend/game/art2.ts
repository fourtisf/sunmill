// @ts-nocheck
/* SUNMILL — world sprites (terrain, crops, buildings, animals, decor, FX).
 *
 * Ported VERBATIM from the prototype's art2.js. Do not edit (CLAUDE.md golden
 * rule 2). The only change from the prototype is the module wrapper: the IIFE
 * that read `root.ART` and assigned to `window.W` became an import and an
 * ES export. Every sprite function is byte-identical.
 */

import { ART as A } from './art';

const lg=A.lg, rg=A.rg, ell=A.ell, rr=A.rr, poly=A.poly, contact=A.contact, ink=A.ink, mix=A.mix, prng=A.prng;

const TW=128, TH=64, HZ=56;
function iso(x,y){return{x:(x-y)*TW/2,y:(x+y)*TH/2}}

/* ---- iso box: returns nothing, paints top+left+right faces ---- */
function box(c,w,d,h,top,left,right,lift){
  const z=(h)*HZ, L=lift?lift*HZ:0;
  const A0=[0,-L],B=[w*TW/2,w*TH/2-L],C=[(w-d)*TW/2,(w+d)*TH/2-L],D=[-d*TW/2,d*TH/2-L];
  const At=[A0[0],A0[1]-z],Bt=[B[0],B[1]-z],Ct=[C[0],C[1]-z],Dt=[D[0],D[1]-z];
  poly(c,[B,C,Ct,Bt]);c.fillStyle=right;c.fill();ink(c,1.5,.3);
  poly(c,[D,C,Ct,Dt]);c.fillStyle=left;c.fill();ink(c,1.5,.3);
  poly(c,[At,Bt,Ct,Dt]);c.fillStyle=top;c.fill();ink(c,1.5,.3);
  return{At:At,Bt:Bt,Ct:Ct,Dt:Dt};
}
function shade(c,base,dir){ // dir 0 top,1 left,2 right
  const f=dir===0?1:(dir===1?.74:.86);
  return mix('#000000',base,f);
}
function boxC(c,w,d,h,base,lift){
  return box(c,w,d,h,
    lg(c,-d*TW/2,-h*HZ,w*TW/2,(w+d)*TH/2-h*HZ,[[0,mix(base,'#ffffff',.22)],[1,base]]),
    lg(c,-d*TW/2,0,0,d*TH/2,[[0,shade(c,base,1)],[1,mix(shade(c,base,1),'#000000',.16)]]),
    lg(c,w*TW/2,0,0,w*TH/2,[[0,shade(c,base,2)],[1,mix(shade(c,base,2),'#000000',.1)]]),lift);
}
/* ---- face transforms. Origin = bottom-centre of that wall face.
   In face space +x runs along the wall, +y runs DOWN. ---- */
const FL=Math.sqrt((TW/2)*(TW/2)+(TH/2)*(TH/2));
const UX=(TW/2)/FL, UY=(TH/2)/FL;
function faceR(c,w,d){ /* the x=w wall, faces lower-right */
  c.transform(UX,-UY,0,1,(2*w-d)*TW/4,(2*w+d)*TH/4);
}
function faceL(c,w,d){ /* the y=d wall, faces lower-left */
  c.transform(UX,UY,0,1,(w-2*d)*TW/4,(w+2*d)*TH/4);
}
/* gable roof sitting on a w x d box of height h. Ridge runs along x. */
function gable(c,w,d,h,roof,wall,rise,over){
  const o=over==null?.15:over, R=rise*HZ, Z=h*HZ;
  const p=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2-Z];
  const b1=p(-o,-o), b2=p(w+o,-o), b3=p(w+o,d+o), b4=p(-o,d+o);
  const q1=p(-o,d/2), q2=p(w+o,d/2);
  const R1=[q1[0],q1[1]-R], R2=[q2[0],q2[1]-R];
  /* back slope */
  poly(c,[b1,b2,R2,R1]);c.fillStyle=mix(roof,'#000000',.42);c.fill();
  /* gable end wall at x=w */
  const g1=p(w,0),g2=p(w,d),ga=p(w,d/2);
  poly(c,[g1,g2,[ga[0],ga[1]-R]]);
  c.fillStyle=lg(c,g1[0],g1[1]-R,g2[0],g2[1],[[0,mix(wall,'#ffffff',.14)],[1,mix(wall,'#000000',.26)]]);
  c.fill();ink(c,1.5,.3);
  /* front slope */
  poly(c,[b4,b3,R2,R1]);
  c.fillStyle=lg(c,R1[0],R1[1],b3[0],b3[1],[[0,mix(roof,'#ffffff',.34)],[.55,roof],[1,mix(roof,'#000000',.14)]]);
  c.fill();ink(c,1.6,.34);
  /* shingle rows on front slope */
  c.save();poly(c,[b4,b3,R2,R1]);c.clip();
  c.globalAlpha=.16;c.strokeStyle='#000';c.lineWidth=2;
  for(let i=1;i<6;i++){const u=i/6;
    const s1=[R1[0]+(b4[0]-R1[0])*u,R1[1]+(b4[1]-R1[1])*u];
    const s2=[R2[0]+(b3[0]-R2[0])*u,R2[1]+(b3[1]-R2[1])*u];
    c.beginPath();c.moveTo(s1[0],s1[1]);c.lineTo(s2[0],s2[1]);c.stroke()}
  c.restore();
  /* barge board on the visible gable edge + ridge cap */
  c.strokeStyle=mix(roof,'#ffffff',.5);c.lineWidth=3.4;c.lineCap='round';
  c.beginPath();c.moveTo(R2[0],R2[1]);c.lineTo(b3[0],b3[1]);c.stroke();
  c.strokeStyle=mix(roof,'#ffffff',.62);c.lineWidth=4;
  c.beginPath();c.moveTo(R1[0],R1[1]);c.lineTo(R2[0],R2[1]);c.stroke();
  return{R1:R1,R2:R2,ridgeMid:[(R1[0]+R2[0])/2,(R1[1]+R2[1])/2],eaveF:b3,top:Z+R};
}
/* full house: centred on its footprint, walls + roof. */
function house(c,w,d,h,wall,roof,rise,over){
  c.translate(-(w-d)*TW/4,-(w+d)*TH/4);
  contact(c,(w-d)*TW/4,(w+d)*TH/4+6,(w+d)*30,(w+d)*11,.33);
  boxC(c,w,d,h,wall);
  return gable(c,w,d,h,roof,wall,rise,over);
}

/* ================= TERRAIN ================= */
function grassTuft(c,x,y,s,col){
  c.strokeStyle=col;c.lineWidth=1.6*s;c.lineCap='round';
  c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x-2*s,y-4*s,x-3.4*s,y-7*s);
  c.moveTo(x,y);c.quadraticCurveTo(x,y-5*s,x+.3*s,y-9*s);
  c.moveTo(x,y);c.quadraticCurveTo(x+2*s,y-4*s,x+3.6*s,y-6.6*s);c.stroke();
}
function island(c,W,D,t){
  const p=(x,y)=>{const q=iso(x,y);return[q.x,q.y]};
  const c1=p(0,0),c2=p(W,0),c3=p(W,D),c4=p(0,D);
  const dep=78;
  c.save();
  for(let s=0;s<5;s++){
    c.globalAlpha=.09;c.fillStyle='rgba(8,20,4,1)';
    const gx=(c1[0]+c3[0])/2, gy=(c1[1]+c3[1])/2+dep+30;
    ell(c,gx,gy,(c2[0]-c4[0])/2+30-s*3,dep*.5+22-s*3);c.fill();
  }
  c.restore();
  /* earth sides */
  const soilR=lg(c,c2[0],c2[1],c3[0],c3[1]+dep,[[0,'#8A6134'],[.35,'#6E4A24'],[1,'#402A12']]);
  poly(c,[c2,c3,[c3[0],c3[1]+dep],[c2[0],c2[1]+dep]]);c.fillStyle=soilR;c.fill();
  const soilL=lg(c,c4[0],c4[1],c3[0],c3[1]+dep,[[0,'#6E4A24'],[.4,'#54381A'],[1,'#31200C']]);
  poly(c,[c4,c3,[c3[0],c3[1]+dep],[c4[0],c4[1]+dep]]);c.fillStyle=soilL;c.fill();
  c.save();c.globalAlpha=.35;c.strokeStyle='#2A1A08';c.lineWidth=2;
  for(let i=1;i<4;i++){const yy=i*dep/4;
    c.beginPath();c.moveTo(c2[0],c2[1]+yy);c.lineTo(c3[0],c3[1]+yy);c.lineTo(c4[0],c4[1]+yy);c.stroke()}
  c.restore();
  c.save();c.globalAlpha=.5;c.fillStyle='#9C7040';
  for(let i=0;i<26;i++){const s=prng(i*31);
    const along=s, side=prng(i*17)>.5;
    const x=side?c2[0]+(c3[0]-c2[0])*along:c4[0]+(c3[0]-c4[0])*along;
    const y0=side?c2[1]+(c3[1]-c2[1])*along:c4[1]+(c3[1]-c4[1])*along;
    ell(c,x,y0+8+prng(i*7)*dep*.8,3+prng(i*11)*4,2+prng(i*13)*2.4,prng(i*3)*3);c.fill()}
  c.restore();
  /* grass lip */
  c.fillStyle='#4E8A28';
  poly(c,[c2,c3,[c3[0],c3[1]+11],[c2[0],c2[1]+11]]);c.fill();
  c.fillStyle='#3E7020';
  poly(c,[c4,c3,[c3[0],c3[1]+11],[c4[0],c4[1]+11]]);c.fill();
  /* top grass */
  const grassG=lg(c,c1[0],c1[1],c3[0],c3[1],[[0,'#8FC94A'],[.42,'#6FB035'],[1,'#4E8A24']]);
  poly(c,[c1,c2,c3,c4]);
  c.save();c.clip();
  c.fillStyle=grassG;
  c.fillRect(c4[0],c1[1],c2[0]-c4[0],c3[1]-c1[1]);
  /* mown bands */
  c.globalAlpha=.13;
  for(let i=0;i<D;i+=1){c.fillStyle=i%2?'#DFF7A8':'#2F5E12';
    const a=p(0,i),b=p(W,i),bb=p(W,i+1),aa=p(0,i+1);
    poly(c,[a,b,bb,aa]);c.fill()}
  c.globalAlpha=1;
  /* tufts + flowers */
  for(let i=0;i<340;i++){
    const gx=prng(i*97)*W, gy=prng(i*53)*D;
    const s=iso(gx,gy);
    const sc=.7+prng(i*7)*.6;
    grassTuft(c,s.x,s.y,sc,i%3?'rgba(60,110,26,.55)':'rgba(180,226,110,.5)');
  }
  for(let i=0;i<54;i++){
    const gx=prng(i*181)*W, gy=prng(i*211)*D, s=iso(gx,gy);
    const cols=['#FFE066','#FF8FA3','#FFFFFF','#C79BFF'];
    const col=cols[Math.floor(prng(i*23)*4)];
    c.fillStyle='rgba(50,90,20,.5)';c.fillRect(s.x-.6,s.y-5,1.2,5);
    c.fillStyle=col;
    for(let k=0;k<5;k++){const a=k/5*6.2832;ell(c,s.x+Math.cos(a)*2.2,s.y-6.4+Math.sin(a)*1.7,1.7,1.4);c.fill()}
    c.fillStyle='#F5B417';ell(c,s.x,s.y-6.4,1.2,1);c.fill();
  }
  c.restore();
  poly(c,[c1,c2,c3,c4]);c.strokeStyle='rgba(40,70,14,.35)';c.lineWidth=2;c.stroke();
}

/* ================= CROPS (field scale) ================= */
const CROP={};
CROP.wheat=function(c,p,t,k){
  const H=6+p*30, gold=Math.max(0,(p-.5)/.5);
  const col=mix('#6FAE2E','#E8B93C',gold);
  const sw=Math.sin(t*1.6+k)*(1.4+p*2.2);
  for(let i=0;i<3;i++){
    const dx=(i-1)*4.6;
    c.strokeStyle=col;c.lineWidth=1.9;c.lineCap='round';
    c.beginPath();c.moveTo(dx,0);c.quadraticCurveTo(dx+sw*.4,-H*.6,dx+sw,-H);c.stroke();
    if(p>.55){
      const hx=dx+sw,hy=-H;
      c.fillStyle=lg(c,hx-3,hy-8,hx+3,hy,[[0,'#FFE58F'],[1,'#D89B18']]);
      for(let g=0;g<4;g++){const y=hy+g*3.1;
        ell(c,hx-2,y,2.2,1.5,-.5);c.fill();ell(c,hx+2,y,2.2,1.5,.5);c.fill()}
      c.strokeStyle='#E8B93C';c.lineWidth=1;
      c.beginPath();c.moveTo(hx,hy-1);c.lineTo(hx-1.6,hy-6);c.moveTo(hx,hy-1);c.lineTo(hx+1.4,hy-6);c.stroke();
    }
  }
};
CROP.corn=function(c,p,t,k){
  const H=8+p*46, sw=Math.sin(t*1.3+k)*(1.2+p*2.6);
  c.strokeStyle=lg(c,0,-H,0,0,[[0,'#8FC63E'],[1,'#4E8A1E']]);c.lineWidth=3;c.lineCap='round';
  c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(sw*.4,-H*.55,sw,-H);c.stroke();
  c.fillStyle=lg(c,-12,-H,12,0,[[0,'#A8D64A'],[1,'#3F7818']]);
  for(let i=0;i<3;i++){
    const y=-H*(.35+i*.22), d=i%2?1:-1, L=7+p*10;
    c.beginPath();c.moveTo(sw*.5*d,y);
    c.quadraticCurveTo(d*L,y-5,d*L*1.5+sw,y-9);
    c.quadraticCurveTo(d*L*.7,y-2,sw*.5*d,y);c.closePath();c.fill();
  }
  if(p>.7){
    const cy=-H*.55;
    c.fillStyle=lg(c,-4,cy-9,4,cy+7,[[0,'#FFE070'],[1,'#D9930F']]);
    ell(c,sw*.6+4,cy,3.4,8,.16);c.fill();ink(c,1.1,.3);
    c.fillStyle='#5E9420';ell(c,sw*.6+2.6,cy-1,2.4,8.4,.14);c.fill();
  }
  if(p>.85){c.strokeStyle='#C99A2E';c.lineWidth=1.2;c.lineCap='round';
    for(let i=-1;i<2;i++){c.beginPath();c.moveTo(sw,-H);c.quadraticCurveTo(sw+i*3,-H-6,sw+i*5,-H-10);c.stroke()}}
};
CROP.carrot=function(c,p,t,k){
  const H=5+p*20, sw=Math.sin(t*1.9+k)*1.6;
  if(p>.7){const g=(p-.7)/.3;
    c.fillStyle=lg(c,-5,-6,5,3,[[0,'#FFA94D'],[1,'#C85B08']]);
    ell(c,0,-2,4.4*g+1.4,3.4*g+1.2);c.fill();ink(c,1,.3)}
  c.strokeStyle='#4E8A1E';c.lineWidth=1.6;c.lineCap='round';
  for(let i=0;i<5;i++){
    const a=(i-2)*.3, ex=Math.sin(a)*H*.6+sw, ey=-H*(.7+Math.cos(a)*.3);
    c.beginPath();c.moveTo(0,-2);c.quadraticCurveTo(ex*.4,ey*.6,ex,ey);c.stroke();
    c.fillStyle=i%2?'#8FC63E':'#5E9420';
    for(let j=1;j<=3;j++){const tt=j/3,px=ex*tt+sw*.3,py=-2+(ey+2)*tt;
      ell(c,px-1.8,py,2,1.3,-.5);c.fill();ell(c,px+1.8,py,2,1.3,.5);c.fill()}
  }
};
CROP.soybean=function(c,p,t,k){
  const R=4+p*13, sw=Math.sin(t*1.5+k)*1.5;
  c.strokeStyle='#4E8A1E';c.lineWidth=2;
  c.beginPath();c.moveTo(0,0);c.lineTo(sw*.5,-R*.7);c.stroke();
  for(let i=0;i<6;i++){
    const a=i/6*6.2832+k, dx=Math.cos(a)*R*.72+sw, dy=-R*.75+Math.sin(a)*R*.34;
    c.fillStyle=lg(c,dx-5,dy-5,dx+5,dy+4,[[0,'#B6DC52'],[1,'#4E8A1E']]);
    ell(c,dx,dy,R*.46,R*.34,a*.3);c.fill();ink(c,.9,.24);
  }
  if(p>.7){const g=(p-.7)/.3;
    c.fillStyle=lg(c,-4,-6,4,4,[[0,'#D8E88A'],[1,'#8AAE30']]);
    for(const d of[-1,1]){c.save();c.translate(d*R*.5,-R*.35);c.rotate(d*.5);
      ell(c,0,0,2.2*g+.8,6*g+1.6);c.fill();ink(c,.9,.26);c.restore()}}
};
CROP.sugarcane=function(c,p,t,k){
  const H=8+p*52, sw=Math.sin(t*1.1+k)*(1.2+p*3);
  for(let i=0;i<3;i++){
    const dx=(i-1)*5, hh=H*(.82+prng(k*7+i)*.3);
    c.strokeStyle=lg(c,0,-hh,0,0,[[0,'#C8DE72'],[1,'#5E8A18']]);c.lineWidth=3.4;c.lineCap='round';
    c.beginPath();c.moveTo(dx,0);c.quadraticCurveTo(dx+sw*.4,-hh*.55,dx+sw,-hh);c.stroke();
    c.strokeStyle='rgba(60,90,14,.45)';c.lineWidth=1.1;
    for(let s=1;s*10<hh;s++){const tt=s*10/hh,x=dx+sw*tt*tt,y=-s*10;
      c.beginPath();c.moveTo(x-2,y);c.lineTo(x+2,y);c.stroke()}
    if(p>.35){c.fillStyle='#6FA82E';
      for(const d of[-1,1]){c.beginPath();c.moveTo(dx+sw,-hh);
        c.quadraticCurveTo(dx+sw+d*9,-hh-6,dx+sw+d*5,-hh-14);
        c.quadraticCurveTo(dx+sw+d*2,-hh-6,dx+sw,-hh);c.closePath();c.fill()}}
  }
};

function plot(c,crop,p,t,k,ready){
  const w=.9,d=.9;
  const P=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2];
  const a=P(-w/2,-d/2),b=P(w/2,-d/2),e=P(w/2,d/2),f=P(-w/2,d/2);
  poly(c,[a,b,e,f]);
  c.fillStyle=lg(c,a[0],a[1],e[0],e[1],[[0,'#8A6238'],[.5,'#6B4A28'],[1,'#4E351A']]);c.fill();
  c.save();c.clip();
  c.strokeStyle='rgba(48,32,14,.45)';c.lineWidth=3.2;
  for(let i=1;i<5;i++){const u=i/5;const s1=P(-w/2+w*u,-d/2),s2=P(-w/2+w*u,d/2);
    c.beginPath();c.moveTo(s1[0],s1[1]);c.lineTo(s2[0],s2[1]);c.stroke()}
  c.strokeStyle='rgba(160,120,72,.3)';c.lineWidth=1.6;
  for(let i=1;i<5;i++){const u=i/5;const s1=P(-w/2+w*u,-d/2),s2=P(-w/2+w*u,d/2);
    c.beginPath();c.moveTo(s1[0]-2,s1[1]-1);c.lineTo(s2[0]-2,s2[1]-1);c.stroke()}
  c.globalAlpha=.3;c.fillStyle='#3A2610';
  for(let i=0;i<16;i++){const s=prng(k*29+i*13);ell(c,(s-.5)*54,(prng(k*31+i*7)-.5)*26,2.4,1.4,s*3);c.fill()}
  c.restore();
  poly(c,[a,b,e,f]);c.strokeStyle='rgba(120,86,44,.6)';c.lineWidth=2.2;c.stroke();
  if(crop&&p>0){
    const fn=CROP[crop];if(fn){
      const spots=[[-.24,-.24],[.24,-.24],[0,0],[-.24,.24],[.24,.24]];
      spots.forEach(function(s,i){
        const q=P(s[0],s[1]);
        c.save();c.translate(q[0],q[1]);
        c.save();c.globalAlpha=.22;c.fillStyle='#2A1C0A';ell(c,0,0,7*p+3,3*p+1.4);c.fill();c.restore();
        fn(c,p,t,k*3+i);c.restore();
      });
    }
  }
  if(ready){
    const bob=Math.sin(t*3.4+k)*3;
    c.save();c.globalAlpha=.5+Math.sin(t*4+k)*.2;
    c.fillStyle=rg(c,0,-30+bob,2,34,[[0,'rgba(255,235,150,.9)'],[1,'rgba(255,220,120,0)']]);
    ell(c,0,-30+bob,34,26);c.fill();c.restore();
    for(let i=0;i<4;i++){const a2=t*1.6+i*1.57,r=20+Math.sin(t*2+i)*7;
      const x=Math.cos(a2)*r,y=-26+Math.sin(a2)*r*.4+bob;
      c.save();c.globalAlpha=.55+Math.sin(t*5+i)*.4;c.fillStyle='#FFF3B0';
      c.beginPath();for(let s=0;s<8;s++){const aa=s/8*6.2832,rr2=s%2?1.4:4.2;
        const px=x+Math.cos(aa)*rr2,py=y+Math.sin(aa)*rr2;s?c.lineTo(px,py):c.moveTo(px,py)}
      c.closePath();c.fill();c.restore()}
  }
}

/* ================= BUILDINGS ================= */
function windowPane(c,x,y,w,h){
  rr(c,x,y,w,h,2.4);c.fillStyle=lg(c,x,y,x+w,y+h,[[0,'#BFE9FF'],[.5,'#68B8E0'],[1,'#2E7CA8']]);c.fill();ink(c,1.6,.4);
  c.save();c.globalAlpha=.5;c.fillStyle='#fff';poly(c,[[x+1,y+h-1],[x+w*.6,y+1],[x+w*.85,y+1],[x+1,y+h*.7]]);c.fill();c.restore();
  c.strokeStyle='rgba(255,255,255,.7)';c.lineWidth=1.4;
  c.beginPath();c.moveTo(x+w/2,y);c.lineTo(x+w/2,y+h);c.moveTo(x,y+h/2);c.lineTo(x+w,y+h/2);c.stroke();
}
const BLD={};
function doorArch(c,fw,fh,frame,inner){
  rr(c,-fw/2,-fh,fw,fh,3);c.fillStyle=frame;c.fill();ink(c,1.7,.42);
  rr(c,-fw/2+3.4,-fh+3.4,fw-6.8,fh-3.4,2);c.fillStyle=inner;c.fill();
}
BLD.barn=function(c,t){
  const w=1.4,d=1.2,h=.8,rise=.5;
  c.save();
  const an=house(c,w,d,h,'#C64533','#8A2418',rise,.09);
  /* big doors on the gable end (x=w) */
  c.save();faceR(c,w,d);
  const fw=d*FL;
  c.fillStyle='#F2E6CC';rr(c,-fw*.33,-h*HZ+2,fw*.66,h*HZ-2,3);c.fill();ink(c,1.6,.36);
  c.fillStyle=lg(c,-fw*.3,-h*HZ,fw*.3,0,[[0,'#A8301F'],[1,'#6E1810']]);
  rr(c,-fw*.3,-h*HZ+5,fw*.6,h*HZ-5,2);c.fill();
  c.strokeStyle='#F2E6CC';c.lineWidth=3;c.lineCap='round';
  const dw=fw*.6,dh=h*HZ-6, x0=-fw*.3,y0=-h*HZ+5.6;
  c.beginPath();
  c.moveTo(x0+1,y0+1);c.lineTo(x0+dw/2-1,y0+dh-1);
  c.moveTo(x0+dw/2-1,y0+1);c.lineTo(x0+1,y0+dh-1);
  c.moveTo(x0+dw/2+1,y0+1);c.lineTo(x0+dw-1,y0+dh-1);
  c.moveTo(x0+dw-1,y0+1);c.lineTo(x0+dw/2+1,y0+dh-1);
  c.moveTo(x0+dw/2,y0);c.lineTo(x0+dw/2,y0+dh);
  c.stroke();
  /* hayloft window up in the gable triangle */
  c.fillStyle='#F2E6CC';rr(c,-8,-h*HZ-rise*HZ*.62,16,15,3);c.fill();ink(c,1.5,.34);
  c.fillStyle='#3A2412';rr(c,-5.6,-h*HZ-rise*HZ*.62+2.4,11.2,10.2,2);c.fill();
  c.restore();
  /* side windows on the long wall */
  c.save();faceL(c,w,d);
  for(const dx of[-26,20]){c.save();c.translate(dx,-h*HZ*.62);windowPane(c,0,0,19,17);c.restore()}
  c.restore();
  /* cupola on the ridge */
  c.save();c.translate(an.ridgeMid[0],an.ridgeMid[1]);
  c.fillStyle=lg(c,-11,-20,11,0,[[0,'#F2E6CC'],[1,'#C4B08A']]);rr(c,-10,-18,20,19,2);c.fill();ink(c,1.4,.34);
  c.fillStyle='#3A2412';rr(c,-5,-13,10,9,1.6);c.fill();
  c.fillStyle='#8A2418';poly(c,[[-14,-18],[0,-30],[14,-18]]);c.fill();ink(c,1.4,.34);
  c.strokeStyle='#5E3A16';c.lineWidth=2;c.beginPath();c.moveTo(0,-30);c.lineTo(0,-40);c.stroke();
  c.fillStyle='#E8B93C';poly(c,[[0,-40],[11,-36],[0,-32]]);c.fill();
  c.restore();
  c.restore();
};
BLD.coop=function(c,t){
  const w=.85,d=.78,h=.5,rise=.28;
  c.save();
  const an=house(c,w,d,h,'#E8C98A','#C4402E',rise,.12);
  c.save();faceR(c,w,d);
  c.fillStyle='#7E5220';c.beginPath();
  c.moveTo(-9,0);c.lineTo(-9,-14);c.quadraticCurveTo(0,-22,9,-14);c.lineTo(9,0);c.closePath();c.fill();ink(c,1.5,.38);
  c.fillStyle='#241608';c.beginPath();
  c.moveTo(-6,0);c.lineTo(-6,-13);c.quadraticCurveTo(0,-19,6,-13);c.lineTo(6,0);c.closePath();c.fill();
  c.fillStyle='#C4923A';poly(c,[[-7,0],[7,0],[13,13],[-1,13]]);c.fill();ink(c,1.3,.34);
  c.restore();
  c.save();faceL(c,w,d);c.translate(-14,-h*HZ*.6);windowPane(c,0,0,15,13);c.restore();
  c.save();c.translate(an.R2[0],an.R2[1]);
  c.strokeStyle='#5E3A16';c.lineWidth=2;c.beginPath();c.moveTo(0,0);c.lineTo(0,-16);c.stroke();
  c.fillStyle='#C4402E';poly(c,[[0,-16],[13,-12],[0,-8]]);c.fill();
  c.restore();
  c.restore();
};
BLD.bakery=function(c,t){
  const w=1.2,d=1.1,h=.72,rise=.38;
  c.save();
  const an=house(c,w,d,h,'#F0E2C0','#B85C2E',rise,.1);
  /* oven arch on gable end */
  c.save();faceR(c,w,d);
  c.fillStyle=lg(c,-20,-h*HZ,20,0,[[0,'#A8792E'],[1,'#5E3A12']]);
  c.beginPath();c.moveTo(-17,0);c.lineTo(-17,-20);c.quadraticCurveTo(0,-36,17,-20);c.lineTo(17,0);c.closePath();c.fill();ink(c,1.7,.42);
  c.fillStyle=lg(c,0,-26,0,-2,[[0,'#FFD86B'],[1,'#D96A12']]);
  c.beginPath();c.moveTo(-11,0);c.lineTo(-11,-19);c.quadraticCurveTo(0,-31,11,-19);c.lineTo(11,0);c.closePath();c.fill();
  c.save();c.globalAlpha=.55;c.fillStyle='#FFF6D0';ell(c,0,-13,7,8);c.fill();c.restore();
  c.fillStyle='#8A5410';rr(c,-13,-3,26,4,1.6);c.fill();
  /* sign in the gable */
  c.fillStyle='#8A5410';rr(c,-15,-h*HZ-rise*HZ*.66,30,13,3);c.fill();ink(c,1.4,.34);
  c.fillStyle='#FFE9A8';ell(c,0,-h*HZ-rise*HZ*.66+6.4,8,4.4);c.fill();
  c.restore();
  /* striped awning on the long wall */
  c.save();faceL(c,w,d);c.translate(0,-h*HZ*.66);
  for(let i=0;i<6;i++){const x=-33+i*11;
    c.fillStyle=i%2?'#F2E6CC':'#C4402E';
    poly(c,[[x,0],[x+11,0],[x+11,13],[x+5.5,17],[x,13]]);c.fill()}
  c.strokeStyle='rgba(70,40,14,.4)';c.lineWidth=1.5;
  c.beginPath();c.moveTo(-33,0);c.lineTo(33,0);c.stroke();
  c.restore();
  /* chimney rising from the ridge */
  c.save();c.translate(an.ridgeMid[0]+24,an.ridgeMid[1]+8);
  c.fillStyle=lg(c,-9,0,9,0,[[0,'#B85C2E'],[.38,'#DB8752'],[1,'#7E3A16']]);rr(c,-9,-36,18,40,2);c.fill();ink(c,1.6,.36);
  c.fillStyle='#8A4520';rr(c,-11,-40,22,7,2);c.fill();ink(c,1.5,.36);
  for(let i=0;i<4;i++){const ph=(t*.4+i*.25)%1;
    c.save();c.globalAlpha=(1-ph)*.45;c.fillStyle='#F2EDE2';
    ell(c,Math.sin(ph*4+i)*12,-44-ph*58,6+ph*14,5+ph*12);c.fill();c.restore()}
  c.restore();
  c.restore();
};
BLD.dairy=function(c,t){
  const w=1.18,d=1.08,h=.7,rise=.36;
  c.save();
  const an=house(c,w,d,h,'#F2F6F9','#3A8FC4',rise,.1);
  c.save();faceR(c,w,d);
  c.fillStyle=lg(c,-15,-h*HZ,15,0,[[0,'#78A8C4'],[1,'#3A6480']]);
  rr(c,-14,-h*HZ+4,28,h*HZ-4,3);c.fill();ink(c,1.7,.4);
  c.fillStyle='rgba(255,255,255,.42)';rr(c,-10,-h*HZ+8,8,h*HZ-14,3);c.fill();
  c.fillStyle='#E8C24A';ell(c,7,-14,2,2);c.fill();
  /* milk badge in the gable */
  c.fillStyle='#F2F7FA';ell(c,0,-h*HZ-rise*HZ*.6,12,12);c.fill();ink(c,1.5,.34);
  c.fillStyle='#3A8FC4';ell(c,0,-h*HZ-rise*HZ*.6+1.6,7.4,5.6);c.fill();
  c.fillStyle='#fff';ell(c,-2.4,-h*HZ-rise*HZ*.6-.8,2.8,2.1,-.4);c.fill();
  c.restore();
  c.save();faceL(c,w,d);
  for(const dx of[-22,16]){c.save();c.translate(dx,-h*HZ*.6);windowPane(c,0,0,18,16);c.restore()}
  c.restore();
  /* milk churns out front */
  c.save();c.translate(-d*TW/2-14,d*TH/2+22);
  for(const q of[[0,0,1],[22,6,.86]]){
    c.save();c.translate(q[0],q[1]);c.scale(q[2],q[2]);
    contact(c,0,2,15,6,.3);
    c.fillStyle=lg(c,-13,-30,13,0,[[0,'#8FA6B4'],[.28,'#E8F0F5'],[.68,'#B4C4CE'],[1,'#63788A']]);
    c.beginPath();c.moveTo(-12,0);c.lineTo(-10,-22);c.quadraticCurveTo(-10,-28,-6.4,-29);c.lineTo(6.4,-29);
    c.quadraticCurveTo(10,-28,10,-22);c.lineTo(12,0);c.quadraticCurveTo(0,4.6,-12,0);c.closePath();c.fill();ink(c,1.5,.34);
    c.fillStyle='#93A8B6';ell(c,0,-29,8.4,3.2);c.fill();ink(c,1.3,.34);
    c.strokeStyle='rgba(60,80,96,.4)';c.lineWidth=1.9;
    c.beginPath();c.moveTo(-11.4,-8);c.quadraticCurveTo(0,-3.4,11.4,-8);c.stroke();
    c.restore();
  }
  c.restore();
  c.restore();
};
BLD.sugarmill=function(c,t){
  const w=1.18,d=1.08,h=.92;
  c.save();
  c.translate(-(w-d)*TW/4,-(w+d)*TH/4);
  contact(c,(w-d)*TW/4,(w+d)*TH/4+6,(w+d)*30,(w+d)*11,.33);
  boxC(c,w,d,h,'#BFAF92');
  /* flat roof deck with a lip */
  c.save();c.translate(0,-h*HZ);
  const p=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2];
  const e1=p(-.06,-.06),e2=p(w+.06,-.06),e3=p(w+.06,d+.06),e4=p(-.06,d+.06);
  poly(c,[e1,e2,e3,e4]);c.fillStyle='#6E6250';c.fill();ink(c,1.6,.36);
  poly(c,[p(.1,.1),p(w-.1,.1),p(w-.1,d-.1),p(.1,d-.1)]);
  c.fillStyle='#5A5044';c.fill();
  c.restore();
  c.save();faceR(c,w,d);
  c.fillStyle=lg(c,-16,-h*HZ,16,0,[[0,'#8A7C64'],[1,'#4E4436']]);
  rr(c,-15,-40,30,40,3);c.fill();ink(c,1.7,.4);
  c.fillStyle='rgba(255,240,200,.35)';rr(c,-11,-35,8,30,3);c.fill();
  for(const y of[-h*HZ+12,-h*HZ+34]){c.save();c.translate(-2,y);windowPane(c,0,0,18,15);c.restore()}
  c.restore();
  c.save();faceL(c,w,d);
  for(const dx of[-24,14]){c.save();c.translate(dx,-h*HZ*.68);windowPane(c,0,0,18,16);c.restore()}
  c.restore();
  /* stack */
  c.save();c.translate(p2x(w*.72,d*.3),p2y(w*.72,d*.3)-h*HZ);
  c.fillStyle=lg(c,-12,-72,12,0,[[0,'#8A8070'],[.32,'#CCC0A6'],[1,'#5E5648']]);
  c.beginPath();c.moveTo(-10,0);c.lineTo(-12,-72);c.lineTo(12,-72);c.lineTo(10,0);c.closePath();c.fill();ink(c,1.7,.36);
  c.fillStyle='#C4402E';c.fillRect(-13,-58,26,9);c.fillRect(-12,-40,24,8);
  c.fillStyle='#4E4638';rr(c,-14,-78,28,8,2);c.fill();ink(c,1.4,.34);
  for(let i=0;i<5;i++){const ph=(t*.32+i*.2)%1;
    c.save();c.globalAlpha=(1-ph)*.42;c.fillStyle='#EDEDE6';
    ell(c,Math.sin(ph*3.4+i)*15,-82-ph*70,7+ph*16,6+ph*14);c.fill();c.restore()}
  c.restore();
  /* cane bundle leaning on the wall */
  c.save();c.translate(-58,(w+d)*TH/4+14);
  contact(c,0,2,18,7,.3);
  for(let i=0;i<5;i++){c.save();c.rotate((i-2)*.11);
    c.fillStyle=lg(c,-3,-32,3,0,[[0,'#C8DE72'],[1,'#6A9022']]);
    rr(c,-3+(i-2)*3.2,-32,6,32,3);c.fill();ink(c,1.2,.3);c.restore()}
  c.fillStyle='#A8792E';rr(c,-12,-19,24,6,3);c.fill();
  c.restore();
  c.restore();
};
function p2x(x,y){return(x-y)*TW/2}
function p2y(x,y){return(x+y)*TH/2}

BLD.silo=function(c,t){
  contact(c,0,6,42,17,.34);
  const R=31,H=132;
  c.fillStyle=lg(c,-R,0,R,0,[[0,'#93A5B2'],[.26,'#E8F0F6'],[.58,'#B4C2CC'],[1,'#68798A']]);
  c.beginPath();c.moveTo(-R,-H);c.lineTo(-R,-8);c.quadraticCurveTo(0,9,R,-8);c.lineTo(R,-H);c.closePath();c.fill();ink(c,1.8,.34);
  c.save();c.globalAlpha=.26;c.strokeStyle='#4E6070';c.lineWidth=1.6;
  for(let i=1;i<8;i++){const y=-H+i*(H/8);
    c.beginPath();c.moveTo(-R,y);c.quadraticCurveTo(0,y+10,R,y);c.stroke()}
  c.restore();
  c.fillStyle=lg(c,-R,-H-38,R,-H,[[0,'#DBAE52'],[.38,'#C4842A'],[1,'#8A5410']]);
  c.beginPath();c.moveTo(-R-3,-H+2);c.quadraticCurveTo(0,-H-44,R+3,-H+2);c.quadraticCurveTo(0,-H+15,-R-3,-H+2);c.closePath();c.fill();ink(c,1.8,.36);
  c.save();c.globalAlpha=.4;c.fillStyle='#FFE9A8';
  c.beginPath();c.moveTo(-19,-H-4);c.quadraticCurveTo(-8,-H-36,4,-H-29);c.quadraticCurveTo(-8,-H-25,-13,-H-2);c.closePath();c.fill();c.restore();
  c.fillStyle='#6E4A24';rr(c,-4,-H-50,8,12,3);c.fill();
  c.fillStyle='#C4402E';ell(c,0,-H-52,6.4,4.6);c.fill();
  c.fillStyle=lg(c,-13,-50,13,-14,[[0,'#8A5410'],[1,'#5A340A']]);rr(c,-12,-52,24,40,4);c.fill();ink(c,1.6,.34);
  c.fillStyle='rgba(255,235,180,.45)';rr(c,-8,-46,6.4,28,3);c.fill();
  c.fillStyle='#C4923A';ell(c,7,-31,2,2);c.fill();
};
BLD.mill=function(c,t){
  contact(c,0,8,56,22,.34);
  const H=100;
  c.fillStyle=lg(c,-34,0,34,0,[[0,'#7E6A52'],[.28,'#CCB998'],[.6,'#A38F70'],[1,'#5E4C36']]);
  c.beginPath();c.moveTo(-28,-H);c.lineTo(-36,-6);c.quadraticCurveTo(0,10,36,-6);c.lineTo(28,-H);c.closePath();c.fill();ink(c,1.8,.36);
  c.save();c.clip();
  c.globalAlpha=.28;c.fillStyle='#6E5A40';
  for(let r=0;r<9;r++)for(let k=0;k<7;k++){
    const y=-H+6+r*12, ww=13, x=-40+k*13+(r%2?6.5:0);
    rr(c,x,y,ww-2.4,9,2);c.fill()}
  c.restore();
  c.fillStyle=lg(c,-34,-H-38,34,-H,[[0,'#D8543E'],[.4,'#C4402E'],[1,'#7E1E12']]);
  c.beginPath();c.moveTo(-34,-H+4);c.quadraticCurveTo(0,-H-46,34,-H+4);c.closePath();c.fill();ink(c,1.8,.36);
  c.save();c.translate(-28,-50);windowPane(c,0,0,17,15);c.restore();
  c.fillStyle=lg(c,-11,-30,11,0,[[0,'#8A5410'],[1,'#54320A']]);rr(c,-11,-31,22,31,3);c.fill();ink(c,1.6,.34);
  c.fillStyle='#C4923A';ell(c,6,-15,2,2);c.fill();
  c.save();c.translate(0,-H-4);c.rotate(t*.55);
  for(let i=0;i<4;i++){
    c.save();c.rotate(i*1.5708);
    c.fillStyle=lg(c,0,0,0,-54,[[0,'#EDE2C8'],[1,'#B4A084']]);
    poly(c,[[-4,-6],[4,-6],[7,-54],[-7,-54]]);c.fill();ink(c,1.5,.4);
    c.fillStyle='rgba(140,110,70,.4)';
    for(let s=0;s<5;s++)c.fillRect(-5.4-s*.3,-13-s*8.6,11+s*.6,2.4);
    c.restore();
  }
  c.restore();
  c.fillStyle='#4E3A22';ell(c,0,-H-4,7,7);c.fill();
  c.fillStyle='#8A6A40';ell(c,-1.4,-H-5.4,3.4,3.4);c.fill();
};
BLD.shelter=function(c,t,col){
  const w=1.1,d=.92,h=.58;
  c.save();
  c.translate(-(w-d)*TW/4,-(w+d)*TH/4);
  contact(c,(w-d)*TW/4,(w+d)*TH/4+4,52,19,.3);
  const P=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2];
  /* straw floor */
  c.fillStyle=lg(c,-30,-14,30,6,[[0,'#E8C98A'],[1,'#A8792E']]);
  poly(c,[P(.06,.06),P(w-.06,.06),P(w-.06,d-.06),P(.06,d-.06)]);c.fill();
  c.save();poly(c,[P(.06,.06),P(w-.06,.06),P(w-.06,d-.06),P(.06,d-.06)]);c.clip();
  c.strokeStyle='rgba(120,84,20,.35)';c.lineWidth=1.6;
  for(let i=0;i<22;i++){c.beginPath();c.moveTo(-80+i*8,-30);c.lineTo(-50+i*8,44);c.stroke()}
  c.restore();
  for(const s of[[0,0],[w,0],[0,d]]){
    const q=P(s[0],s[1]);
    c.fillStyle=lg(c,q[0]-4,q[1]-h*HZ,q[0]+4,q[1],[[0,'#C4A468'],[1,'#5E3E12']]);
    rr(c,q[0]-4,q[1]-h*HZ,8,h*HZ,2);c.fill();ink(c,1.3,.34)}
  gable(c,w,d,h,col||'#C4402E','#E8C98A',.26,.14);
  const q=P(w,d);
  c.fillStyle=lg(c,q[0]-4,q[1]-h*HZ,q[0]+4,q[1],[[0,'#D9BE86'],[1,'#6E4A18']]);
  rr(c,q[0]-4,q[1]-h*HZ,8,h*HZ,2);c.fill();ink(c,1.3,.34);
  c.restore();
};
BLD.truck=function(c,t,n){
  contact(c,-4,10,72,21,.34);
  c.save();c.translate(0,-6);
  c.fillStyle=lg(c,-70,-52,10,4,[[0,'#F5E4BE'],[.45,'#E0C68E'],[1,'#A8853E']]);
  rr(c,-68,-54,84,50,6);c.fill();ink(c,2,.42);
  c.fillStyle='rgba(120,84,26,.26)';
  for(let i=0;i<5;i++){rr(c,-64+i*16,-50,12,42,3);c.fill()}
  c.fillStyle=lg(c,16,-42,58,2,[[0,'#E0664E'],[.45,'#C4402E'],[1,'#7E1E12']]);
  c.beginPath();c.moveTo(16,-46);c.lineTo(44,-46);c.quadraticCurveTo(56,-46,58,-30);c.lineTo(60,-4);c.lineTo(16,-4);c.closePath();c.fill();ink(c,2,.42);
  c.save();c.translate(34,-40);windowPane(c,0,0,20,17);c.restore();
  c.fillStyle='#FFE9A8';ell(c,57,-12,4.4,4);c.fill();ink(c,1.2,.3);
  c.fillStyle='#5E4632';rr(c,-70,-8,132,9,3);c.fill();
  c.restore();
  for(const wx of[-50,-16,42]){
    c.save();c.translate(wx,4);
    c.fillStyle='#2E2A26';ell(c,0,0,13,13);c.fill();ink(c,1.6,.4);
    c.fillStyle=lg(c,-7,-7,7,7,[[0,'#E8DCC0'],[1,'#9C9084']]);ell(c,0,0,6.4,6.4);c.fill();
    c.fillStyle='#5E5650';ell(c,0,0,2.4,2.4);c.fill();c.restore()}
  if(n>0){
    c.save();c.translate(-24,-76);
    c.translate(0,Math.sin(t*3)*3);
    c.fillStyle='#fff';ell(c,0,0,17,15);c.fill();
    c.fillStyle=lg(c,-16,-14,16,14,[[0,'#FF9A88'],[1,'#D4382A']]);ell(c,0,0,14.4,12.6);c.fill();ink(c,1.6,.3);
    c.fillStyle='#fff';c.font='bold 17px Nunito, sans-serif';c.textAlign='center';c.textBaseline='middle';
    c.fillText(String(n),0,1);
    c.restore();
  }
};
BLD.stand=function(c,t){
  contact(c,0,8,52,19,.32);
  c.save();
  for(const dx of[-40,40]){c.fillStyle=lg(c,dx-4,-60,dx+4,0,[[0,'#A8792E'],[1,'#5E3E12']]);
    rr(c,dx-4.4,-58,8.8,58,2);c.fill();ink(c,1.4,.34)}
  c.fillStyle=lg(c,-48,-22,48,-8,[[0,'#D9BE86'],[1,'#9C7A3A']]);
  rr(c,-48,-24,96,11,3);c.fill();ink(c,1.6,.36);
  c.fillStyle=lg(c,-48,-14,48,0,[[0,'#C4A468'],[1,'#7E6028']]);
  rr(c,-44,-13,88,9,2);c.fill();
  for(let i=0;i<7;i++){c.fillStyle=i%2?'#F2E6CC':'#3A8FC4';
    poly(c,[[-49+i*14,-58],[-49+i*14+14,-58],[-49+i*14+14,-44],[-49+i*14+7,-38],[-49+i*14,-44]]);c.fill()}
  c.strokeStyle='rgba(70,40,14,.35)';c.lineWidth=1.5;
  c.beginPath();c.moveTo(-49,-58);c.lineTo(49,-58);c.stroke();
  c.fillStyle='#8A5410';rr(c,-31,-49,62,14,3);c.fill();ink(c,1.4,.34);
  c.fillStyle='#FFE9A8';c.font='600 12px Fredoka, sans-serif';c.textAlign='center';c.textBaseline='middle';
  c.fillText('MARKET',0,-41.5);
  /* crates of produce on the counter */
  for(const q of[[-28,-24,'#E8B93C'],[0,-24,'#F27A1A'],[28,-24,'#8FC63E']]){
    c.save();c.translate(q[0],q[1]);
    c.fillStyle=q[2];ell(c,-4,-13,5,4);c.fill();ell(c,4,-14,5,4);c.fill();ell(c,0,-16,5,4);c.fill();
    c.fillStyle=lg(c,-11,-12,11,0,[[0,'#C4A468'],[1,'#7E5A1E']]);rr(c,-11,-12,22,12,2);c.fill();ink(c,1.3,.34);
    c.strokeStyle='rgba(90,60,14,.4)';c.lineWidth=1.2;c.beginPath();c.moveTo(-11,-6);c.lineTo(11,-6);c.stroke();
    c.restore()}
  c.restore();
};

/* ================= ANIMALS ================= */
const AN={};
AN.chicken=function(c,o){
  const t=o.t,ph=o.ph||0,walk=o.walk||0,s=o.s||1;
  c.save();c.scale(s*(o.flip?-1:1),s);
  const bob=Math.sin(t*4+ph)*1.3, peck=o.peck||0;
  contact(c,0,1,15,5,.3);
  const lp=walk?Math.sin(t*9+ph):0;
  c.strokeStyle='#E89A2E';c.lineWidth=2.2;c.lineCap='round';
  for(const d of[-1,1]){
    const off=walk?lp*d*3:0;
    c.beginPath();c.moveTo(d*3.2,-9);c.lineTo(d*3.2+off,-1);c.stroke();
    c.beginPath();c.moveTo(d*3.2+off-2.4,0);c.lineTo(d*3.2+off,-1);c.lineTo(d*3.2+off+2.4,0);
    c.moveTo(d*3.2+off,-1);c.lineTo(d*3.2+off+.6,.8);c.stroke();
  }
  c.save();c.translate(0,bob);
  c.fillStyle=lg(c,-10,-24,8,-6,[[0,'#FFFFFF'],[.55,'#F2EADA'],[1,'#C4B698']]);
  c.beginPath();c.moveTo(-12,-14);c.quadraticCurveTo(-13,-25,-2,-26);c.quadraticCurveTo(10,-26,11,-15);c.quadraticCurveTo(11,-6,-1,-6);c.quadraticCurveTo(-12,-6,-12,-14);c.closePath();c.fill();ink(c,1.6,.34);
  c.fillStyle=lg(c,-22,-30,-8,-14,[[0,'#F2EADA'],[1,'#B8A888']]);
  for(let i=0;i<3;i++){c.save();c.translate(-10,-18);c.rotate(-.5+i*.32+Math.sin(t*3+ph)*.05);
    c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(-9,-4,-14,-11);c.quadraticCurveTo(-6,-8,0,-4);c.closePath();c.fill();ink(c,1.1,.26);c.restore()}
  const flap=o.flap?Math.sin(t*16)*.5:0;
  c.save();c.translate(-1,-16);c.rotate(flap);
  c.fillStyle=lg(c,-8,-6,8,7,[[0,'#FFFDF6'],[1,'#CFC0A0']]);
  c.beginPath();c.moveTo(-7,-4);c.quadraticCurveTo(4,-8,8,0);c.quadraticCurveTo(3,7,-6,3);c.closePath();c.fill();ink(c,1.3,.3);
  c.strokeStyle='rgba(120,100,64,.4)';c.lineWidth=1;
  for(let i=0;i<3;i++){c.beginPath();c.moveTo(-4+i*3,-4.4);c.quadraticCurveTo(-1+i*3,1,-3+i*3,4);c.stroke()}
  c.restore();
  /* head */
  c.save();c.translate(7,-25);c.rotate(peck*.9);
  c.fillStyle=lg(c,-7,-8,6,6,[[0,'#FFFFFF'],[1,'#DCD2BC']]);
  c.beginPath();c.moveTo(-4,4);c.quadraticCurveTo(-7,-2,-3,-6);c.quadraticCurveTo(3,-9,6,-3);c.quadraticCurveTo(7,3,2,5);c.closePath();c.fill();ink(c,1.5,.34);
  c.fillStyle=lg(c,-4,-14,4,-5,[[0,'#FF6B5A'],[1,'#C42A18']]);
  for(let i=0;i<3;i++){ell(c,-2.6+i*2.6,-7.4-(i===1?1.6:0),2.2,2.6);c.fill()}
  ink(c,1.1,.24);
  c.fillStyle='#D4382A';c.beginPath();c.moveTo(2,4);c.quadraticCurveTo(4,8,1,8.4);c.quadraticCurveTo(-.4,7,.4,4);c.closePath();c.fill();
  c.fillStyle=lg(c,6,-2,13,3,[[0,'#FFC24A'],[1,'#E07A18']]);
  poly(c,[[5,-1.4],[12,1],[5,3.4]]);c.fill();ink(c,1.1,.3);
  if(!o.blink){c.fillStyle='#241C10';ell(c,1.4,-2.4,1.7,1.9);c.fill();
    c.fillStyle='#fff';ell(c,.9,-3,.7,.7);c.fill()}
  else{c.strokeStyle='#241C10';c.lineWidth=1.4;c.beginPath();c.moveTo(-.2,-2.4);c.lineTo(3,-2.4);c.stroke()}
  c.restore();
  c.restore();
  c.restore();
};
AN.cow=function(c,o){
  const t=o.t,ph=o.ph||0,walk=o.walk||0,s=o.s||1;
  c.save();c.scale(s*(o.flip?-1:1),s);
  const bob=Math.sin(t*2.6+ph)*1.6;
  contact(c,0,2,32,10,.32);
  const lp=walk?Math.sin(t*6.5+ph):0;
  for(const L of[[-15,-.35,1],[13,.35,1],[-11,.2,0],[17,-.2,0]]){
    const off=walk?lp*L[1]*7:0;
    c.fillStyle=L[2]?lg(c,L[0]-5,-26,L[0]+5,0,[[0,'#F2EDE4'],[1,'#BCB2A2']]):lg(c,L[0]-5,-26,L[0]+5,0,[[0,'#E4DED2'],[1,'#A69C8C']]);
    rr(c,L[0]-4.6+off*.4,-24,9.2,25,4);c.fill();ink(c,1.4,.32);
    c.fillStyle='#3A3128';rr(c,L[0]-5.2+off*.5,-4,10.4,5,2.2);c.fill();
  }
  c.save();c.translate(0,bob);
  /* tail */
  const sw=Math.sin(t*2.2+ph)*.45;
  c.save();c.translate(-24,-38);c.rotate(sw);
  c.strokeStyle='#C4BAA8';c.lineWidth=3;c.lineCap='round';
  c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(-6,10,-3,22);c.stroke();
  c.fillStyle='#4A4034';ell(c,-3,24,3.6,5.4);c.fill();c.restore();
  /* body */
  c.fillStyle=lg(c,-26,-56,20,-16,[[0,'#FFFFFF'],[.5,'#F2EDE4'],[1,'#C4BAA8']]);
  c.beginPath();c.moveTo(-26,-32);c.quadraticCurveTo(-28,-56,-8,-58);c.quadraticCurveTo(16,-60,22,-44);c.quadraticCurveTo(26,-28,14,-22);c.quadraticCurveTo(-8,-18,-20,-22);c.quadraticCurveTo(-26,-25,-26,-32);c.closePath();c.fill();
  c.save();c.clip();
  c.fillStyle='#4A3A28';
  ell(c,-14,-44,9,7.4,.4);c.fill();
  ell(c,8,-50,7,5.4,-.3);c.fill();
  ell(c,14,-30,6,4.6,.5);c.fill();
  c.globalAlpha=.14;c.fillStyle='#6E5A40';ell(c,-2,-22,26,7);c.fill();
  c.restore();
  c.beginPath();c.moveTo(-26,-32);c.quadraticCurveTo(-28,-56,-8,-58);c.quadraticCurveTo(16,-60,22,-44);c.quadraticCurveTo(26,-28,14,-22);c.quadraticCurveTo(-8,-18,-20,-22);c.quadraticCurveTo(-26,-25,-26,-32);c.closePath();ink(c,1.8,.34);
  c.fillStyle=lg(c,-6,-24,6,-14,[[0,'#FFC9CE'],[1,'#E08A94']]);
  ell(c,-2,-20,8,5.4);c.fill();ink(c,1.2,.28);
  /* head */
  c.save();c.translate(24,-48);
  const chew=Math.sin(t*7+ph)*.9;
  c.fillStyle='#C4BAA8';
  for(const d of[-1,1]){c.save();c.translate(d*3,-11);c.rotate(d*(.7+Math.sin(t*1.5+ph+d)*.12));
    ell(c,d*7,0,7.4,4,0);c.fill();ink(c,1.2,.3);c.restore()}
  c.fillStyle=lg(c,-4,-20,10,-8,[[0,'#F2EADC'],[1,'#B8AC98']]);
  for(const d of[-1,1]){c.save();c.translate(d*5,-13);c.rotate(d*.5);
    c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(d*2,-7,d*1,-10);c.quadraticCurveTo(d*-2,-6,0,0);c.closePath();c.fill();ink(c,1.1,.3);c.restore()}
  c.fillStyle=lg(c,-12,-14,14,14,[[0,'#FFFFFF'],[.55,'#F0EAE0'],[1,'#C0B6A4']]);
  c.beginPath();c.moveTo(-11,-8);c.quadraticCurveTo(-9,-16,2,-15);c.quadraticCurveTo(14,-14,15,-2);c.quadraticCurveTo(16,10,4,11);c.quadraticCurveTo(-9,11,-11,2);c.closePath();c.fill();ink(c,1.7,.34);
  c.save();c.translate(0,chew*.6);
  c.fillStyle=lg(c,2,-2,16,12,[[0,'#FFD1D6'],[1,'#DA959E']]);
  ell(c,8,4.4,7.4,5.6);c.fill();ink(c,1.4,.3);
  c.fillStyle='#B87078';ell(c,6,3,1.5,2.1);c.fill();ell(c,11,4,1.5,2.1);c.fill();
  c.strokeStyle='#B87078';c.lineWidth=1.2;c.beginPath();c.moveTo(5,8);c.quadraticCurveTo(8.6,9.6,12,8);c.stroke();
  c.restore();
  if(!o.blink){
    for(const e of[[-4,-6],[7,-8]]){
      c.fillStyle='#fff';ell(c,e[0],e[1],3.1,3.3);c.fill();
      c.fillStyle='#241C10';ell(c,e[0]+.5,e[1]+.3,2,2.3);c.fill();
      c.fillStyle='#fff';ell(c,e[0]-.1,e[1]-.7,.8,.8);c.fill();}
  }else{c.strokeStyle='#241C10';c.lineWidth=1.5;
    c.beginPath();c.moveTo(-6.4,-6);c.lineTo(-1.6,-6);c.moveTo(4.6,-8);c.lineTo(9.4,-8);c.stroke()}
  c.restore();
  /* collar + bell */
  c.fillStyle='#C4402E';
  c.beginPath();c.moveTo(13,-46);c.quadraticCurveTo(20,-38,17,-30);c.lineTo(12,-31);c.quadraticCurveTo(15,-38,9,-45);c.closePath();c.fill();ink(c,1.2,.3);
  c.save();c.translate(15.4,-29);c.rotate(sw*.5);
  c.fillStyle=lg(c,-5,-5,5,6,[[0,'#FFE9A8'],[1,'#C4922A']]);
  c.beginPath();c.moveTo(-4.4,3);c.quadraticCurveTo(-4,-4,0,-5.4);c.quadraticCurveTo(4,-4,4.4,3);c.closePath();c.fill();ink(c,1.2,.34);
  c.fillStyle='#8A6208';ell(c,0,4,1.7,1.7);c.fill();c.restore();
  c.restore();
  c.restore();
};
AN.sheep=function(c,o){
  const t=o.t,ph=o.ph||0,walk=o.walk||0,s=o.s||1;
  c.save();c.scale(s*(o.flip?-1:1),s);
  const bob=Math.sin(t*3+ph)*1.2;
  contact(c,0,1,22,7,.3);
  const lp=walk?Math.sin(t*7+ph):0;
  for(const L of[[-9,-.4],[7,.4],[-6,.25],[10,-.25]]){
    const off=walk?lp*L[1]*5:0;
    c.fillStyle=lg(c,L[0]-3,-18,L[0]+3,0,[[0,'#5E5248'],[1,'#332C24']]);
    rr(c,L[0]-2.8+off*.4,-17,5.6,18,2.6);c.fill();ink(c,1.2,.3);
  }
  c.save();c.translate(0,bob);
  c.fillStyle=lg(c,-20,-42,14,-12,[[0,'#FFFFFF'],[.5,'#F5F2EA'],[1,'#CFC8B8']]);
  c.beginPath();
  const N=13,cx=-2,cy=-30,RX=20,RY=15;
  for(let i=0;i<=N;i++){
    const a=i/N*6.2832, x=cx+Math.cos(a)*RX, y=cy+Math.sin(a)*RY;
    const a2=(i+.5)/N*6.2832, x2=cx+Math.cos(a2)*(RX+5.6), y2=cy+Math.sin(a2)*(RY+5);
    i?c.quadraticCurveTo(x2,y2,x,y):c.moveTo(x,y)}
  c.closePath();c.fill();ink(c,1.7,.3);
  c.save();c.globalAlpha=.3;c.strokeStyle='#B8B0A0';c.lineWidth=1.6;c.lineCap='round';
  for(const q of[[-11,-34,5],[2,-38,4.4],[-6,-24,5],[8,-27,4]]){
    c.beginPath();c.arc(q[0],q[1],q[2],.7,4.3);c.stroke()}
  c.restore();
  c.save();c.translate(17,-36);
  const chew=Math.sin(t*8+ph)*.7;
  c.fillStyle=lg(c,-6,-10,8,10,[[0,'#5E5248'],[1,'#2E2820']]);
  for(const d of[-1,1]){c.save();c.translate(d*2,-6);c.rotate(d*(1+Math.sin(t*1.8+ph)*.14));
    ell(c,d*7,0,7,3.4);c.fill();c.restore()}
  c.fillStyle=lg(c,-8,-10,9,11,[[0,'#6E6156'],[.55,'#4A4038'],[1,'#282018']]);
  c.beginPath();c.moveTo(-7,-6);c.quadraticCurveTo(-5,-13,3,-12);c.quadraticCurveTo(11,-11,12,-1);c.quadraticCurveTo(12,8,4,9);c.quadraticCurveTo(-6,9,-7,1);c.closePath();c.fill();ink(c,1.5,.3);
  c.save();c.translate(0,chew*.5);
  c.fillStyle='#3A322A';ell(c,8,3.4,4.6,3.6);c.fill();
  c.fillStyle='#1E1810';ell(c,6.4,2.4,1.1,1.4);c.fill();ell(c,10,3,1.1,1.4);c.fill();c.restore();
  c.fillStyle='#F5F2EA';
  c.beginPath();c.moveTo(-8,-8);c.quadraticCurveTo(-2,-16,4,-13);c.quadraticCurveTo(-3,-11,-6,-4);c.closePath();c.fill();
  if(!o.blink){for(const e of[[-1,-4],[7,-5]]){
    c.fillStyle='#fff';ell(c,e[0],e[1],2.4,2.6);c.fill();
    c.fillStyle='#161008';ell(c,e[0]+.4,e[1]+.2,1.6,1.8);c.fill();
    c.fillStyle='#fff';ell(c,e[0],e[1]-.6,.6,.6);c.fill()}}
  else{c.strokeStyle='#161008';c.lineWidth=1.3;
    c.beginPath();c.moveTo(-2.8,-4);c.lineTo(.8,-4);c.moveTo(5.2,-5);c.lineTo(8.8,-5);c.stroke()}
  c.restore();
  c.restore();
  c.restore();
};

/* ================= FARMER ================= */
function farmer(c,o){
  const t=o.t,walk=o.walk||0,s=o.s||1;
  c.save();c.scale(s*(o.flip?-1:1),s);
  contact(c,0,1,13,4.6,.3);
  const lp=walk?Math.sin(t*8):0, bob=walk?Math.abs(Math.sin(t*8))*1.6:Math.sin(t*2.2)*1;
  for(const d of[-1,1]){
    const off=walk?lp*d*5:0;
    c.fillStyle=lg(c,-4,-22,4,0,[[0,'#4E74B8'],[1,'#2A4680']]);
    rr(c,d*3.4-3.4+off*.5,-20,6.8,20,3);c.fill();ink(c,1.2,.3);
    c.fillStyle='#4A3A28';rr(c,d*3.4-4+off*.6,-3,8,4.4,2);c.fill();
  }
  c.save();c.translate(0,-bob);
  c.fillStyle=lg(c,-10,-46,10,-18,[[0,'#F2E4C4'],[1,'#C4AE84']]);
  c.beginPath();c.moveTo(-8,-20);c.quadraticCurveTo(-10,-42,0,-44);c.quadraticCurveTo(10,-42,8,-20);c.closePath();c.fill();ink(c,1.5,.32);
  c.fillStyle=lg(c,-9,-38,9,-18,[[0,'#5E86C8'],[1,'#2A4680']]);
  c.beginPath();c.moveTo(-8,-20);c.quadraticCurveTo(-9,-36,-4,-38);c.lineTo(4,-38);c.quadraticCurveTo(9,-36,8,-20);c.closePath();c.fill();ink(c,1.4,.3);
  c.strokeStyle='#2A4680';c.lineWidth=2.2;
  c.beginPath();c.moveTo(-4,-38);c.lineTo(-3,-43);c.moveTo(4,-38);c.lineTo(3,-43);c.stroke();
  c.fillStyle='#E8C24A';ell(c,-3.4,-30,1.7,1.7);c.fill();
  for(const d of[-1,1]){
    const sa=walk?-lp*d*.6:Math.sin(t*2.2+d)*.1;
    c.save();c.translate(d*7.4,-38);c.rotate(sa+d*.16);
    c.fillStyle=lg(c,-3,0,3,16,[[0,'#F2E4C4'],[1,'#C4AE84']]);
    rr(c,-2.8,0,5.6,16,2.8);c.fill();ink(c,1.2,.3);
    c.fillStyle='#E8B078';ell(c,0,17,3.4,3.4);c.fill();c.restore()}
  c.fillStyle=lg(c,-8,-58,8,-44,[[0,'#FFE0BC'],[1,'#D9A470']]);
  ell(c,0,-50,8.4,8.8);c.fill();ink(c,1.5,.32);
  c.fillStyle='#7E5A2E';
  c.beginPath();c.moveTo(-8.4,-52);c.quadraticCurveTo(0,-60,8.4,-52);c.quadraticCurveTo(0,-56,-8.4,-52);c.closePath();c.fill();
  if(!o.blink){c.fillStyle='#3A2A18';ell(c,-3,-50,1.5,1.9);c.fill();ell(c,3,-50,1.5,1.9);c.fill()}
  else{c.strokeStyle='#3A2A18';c.lineWidth=1.3;c.beginPath();c.moveTo(-4.4,-50);c.lineTo(-1.6,-50);c.moveTo(1.6,-50);c.lineTo(4.4,-50);c.stroke()}
  c.strokeStyle='#C4785A';c.lineWidth=1.3;c.beginPath();c.arc(0,-46.6,2.6,.35,2.79);c.stroke();
  c.fillStyle='rgba(230,140,120,.35)';ell(c,-5.4,-47,2.4,1.6);c.fill();ell(c,5.4,-47,2.4,1.6);c.fill();
  c.fillStyle=lg(c,-16,-62,16,-54,[[0,'#F5DC9E'],[1,'#C49A3E']]);
  ell(c,0,-56,17,6.4);c.fill();ink(c,1.5,.34);
  c.fillStyle=lg(c,-9,-68,9,-56,[[0,'#F5DC9E'],[1,'#C49A3E']]);
  c.beginPath();c.moveTo(-8.4,-57);c.quadraticCurveTo(-8,-68,0,-68.4);c.quadraticCurveTo(8,-68,8.4,-57);c.closePath();c.fill();ink(c,1.5,.34);
  c.fillStyle='#C4402E';rr(c,-8.6,-60,17.2,3.4,1.6);c.fill();
  c.restore();c.restore();
}

/* ================= DECOR ================= */
const DEC={};
DEC.tree=function(c,t,k){
  const sw=Math.sin(t*.9+k)*.035;
  contact(c,0,4,40,15,.34);
  c.fillStyle=lg(c,-11,-70,11,0,[[0,'#9C7040'],[.4,'#7A5228'],[1,'#4A3014']]);
  c.beginPath();c.moveTo(-9,2);c.quadraticCurveTo(-6,-30,-5,-58);c.lineTo(5,-58);c.quadraticCurveTo(6,-30,9,2);c.closePath();c.fill();ink(c,1.6,.34);
  c.strokeStyle='rgba(50,32,10,.35)';c.lineWidth=1.6;
  c.beginPath();c.moveTo(-3,-6);c.quadraticCurveTo(-1,-30,-2,-52);c.moveTo(3,-8);c.quadraticCurveTo(2,-32,3,-50);c.stroke();
  c.save();c.translate(0,-58);c.rotate(sw);
  const blobs=[[-24,-8,26,'#4E8A24'],[22,-12,24,'#4E8A24'],[0,-34,29,'#5E9E2C'],[-14,-26,24,'#6FB035'],[14,-28,23,'#6FB035'],[0,-6,27,'#3E7A1C']];
  for(const b of blobs){
    c.fillStyle=lg(c,b[0]-b[2],b[1]-b[2],b[0]+b[2]*.6,b[1]+b[2],[[0,mix(b[3],'#DFF7A8',.5)],[.55,b[3]],[1,mix(b[3],'#1E4A0A',.45)]]);
    ell(c,b[0],b[1],b[2],b[2]*.86);c.fill();
  }
  c.save();c.globalAlpha=.28;c.fillStyle='#DFF7A8';
  ell(c,-14,-38,17,12,-.4);c.fill();ell(c,8,-42,12,9,.3);c.fill();c.restore();
  c.save();c.globalAlpha=.2;c.fillStyle='#1E4A0A';
  ell(c,10,-2,22,13,.2);c.fill();c.restore();
  c.restore();
};
DEC.bush=function(c,t,k){
  const sw=Math.sin(t*1.3+k)*.05;
  contact(c,0,2,24,9,.3);
  c.save();c.rotate(sw);
  for(const b of[[-11,-8,13],[11,-9,12],[0,-17,15],[-5,-6,12],[6,-5,11]]){
    c.fillStyle=lg(c,b[0]-b[2],b[1]-b[2],b[0]+b[2]*.6,b[1]+b[2],[[0,'#8FC63E'],[.55,'#4E8A24'],[1,'#2F5E12']]);
    ell(c,b[0],b[1],b[2],b[2]*.85);c.fill()}
  if(k%3===0){c.fillStyle='#E0483A';
    for(let i=0;i<5;i++){const s=prng(k*17+i*7);ell(c,-13+s*26,-20+prng(k*3+i)*16,2.8,2.6);c.fill()}}
  c.restore();
};
DEC.rock=function(c,t,k){
  contact(c,0,2,17,6,.3);
  c.fillStyle=lg(c,-14,-18,12,2,[[0,'#C8CCCE'],[.45,'#9AA0A4'],[1,'#5E6468']]);
  c.beginPath();c.moveTo(-14,0);c.lineTo(-9,-13);c.lineTo(1,-17);c.lineTo(11,-10);c.lineTo(13,0);c.closePath();c.fill();ink(c,1.6,.34);
  c.save();c.globalAlpha=.42;c.fillStyle='#E4E8EA';
  poly(c,[[-9,-13],[1,-17],[3,-9],[-6,-6]]);c.fill();c.restore();
  c.fillStyle='#5E9E2C';
  for(let i=0;i<3;i++){const s=prng(k*11+i*5);ell(c,-12+s*24,-1,4,2.2);c.fill()}
};
DEC.fence=function(c,len,dir){
  const P=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2];
  const step=.5;
  c.save();
  for(let i=0;i<=len/step;i++){
    const d=i*step, q=dir?P(0,d):P(d,0);
    c.fillStyle=lg(c,q[0]-4,q[1]-30,q[0]+4,q[1],[[0,'#D9BE86'],[.4,'#A8792E'],[1,'#5E3E12']]);
    rr(c,q[0]-3.4,q[1]-30,6.8,32,2.4);c.fill();ink(c,1.2,.32);
    c.fillStyle='#C4A468';poly(c,[[q[0]-3.4,q[1]-30],[q[0],q[1]-34],[q[0]+3.4,q[1]-30]]);c.fill();
  }
  for(const yy of[-24,-13]){
    const a=dir?P(0,0):P(0,0), b=dir?P(0,len):P(len,0);
    c.fillStyle=lg(c,a[0],a[1]+yy,b[0],b[1]+yy,[[0,'#C4A468'],[1,'#8A6222']]);
    poly(c,[[a[0],a[1]+yy],[b[0],b[1]+yy],[b[0],b[1]+yy+6],[a[0],a[1]+yy+6]]);c.fill();ink(c,1.1,.28);
  }
  c.restore();
};
DEC.pond=function(c,t,w,d){
  const P=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2];
  const cx=0,cy=0,RX=w*TW/2,RY=d*TH/2;
  c.save();
  c.fillStyle='#6E5228';ell(c,0,3,RX+9,RY+7);c.fill();
  c.fillStyle=lg(c,-RX,-RY,RX,RY,[[0,'#7FD4E8'],[.4,'#35A8D4'],[1,'#12678F']]);
  ell(c,0,0,RX,RY);c.fill();
  c.save();ell(c,0,0,RX,RY);c.clip();
  c.strokeStyle='rgba(255,255,255,.35)';c.lineWidth=2;
  for(let i=0;i<4;i++){const ph=(t*.35+i*.25)%1;
    c.globalAlpha=(1-ph)*.5;ell(c,-RX*.2,-RY*.1,RX*ph*.9,RY*ph*.9);c.stroke()}
  c.globalAlpha=.4;c.fillStyle='#fff';
  ell(c,-RX*.35,-RY*.35,RX*.3,RY*.2,-.3);c.fill();
  c.restore();
  ell(c,0,0,RX,RY);c.strokeStyle='rgba(20,70,90,.4)';c.lineWidth=2.4;c.stroke();
  for(let i=0;i<9;i++){
    const a=prng(i*23)*6.2832, x=Math.cos(a)*RX*.94, y=Math.sin(a)*RY*.94;
    c.strokeStyle='#4E8A24';c.lineWidth=2;c.lineCap='round';
    for(let k=0;k<3;k++){c.beginPath();c.moveTo(x,y);
      c.quadraticCurveTo(x+(k-1)*4,y-11,x+(k-1)*7,y-19);c.stroke()}
    c.fillStyle='#8A6222';ell(c,x+(prng(i*7)-.5)*6,y-20,2,5);c.fill();
  }
  for(let i=0;i<3;i++){
    const s=prng(i*41), x=(s-.5)*RX*1.1, y=(prng(i*13)-.5)*RY*1.1;
    c.fillStyle=lg(c,x-9,y-6,x+9,y+6,[[0,'#6FB035'],[1,'#2F5E12']]);
    c.beginPath();c.arc(x,y,9,.5,6.0);c.closePath();c.fill();
  }
  c.restore();
};
DEC.hay=function(c,t,k){
  contact(c,0,3,26,10,.3);
  c.fillStyle=lg(c,-22,-30,22,2,[[0,'#F5DC9E'],[.4,'#E0BC5E'],[1,'#A8792E']]);
  rr(c,-21,-32,42,34,14);c.fill();ink(c,1.7,.34);
  c.save();c.clip();c.strokeStyle='rgba(150,106,20,.4)';c.lineWidth=1.6;
  for(let i=0;i<7;i++){c.beginPath();c.arc(-6,-15,6+i*4,-1.2,1.4);c.stroke()}
  c.restore();
  c.fillStyle=lg(c,-9,-24,9,-6,[[0,'#FFF0C0'],[1,'#D9B44E']]);
  ell(c,-6,-15,9,10);c.fill();ink(c,1.3,.3);
  c.strokeStyle='#8A6222';c.lineWidth=2.4;
  c.beginPath();c.moveTo(-21,-22);c.quadraticCurveTo(0,-19,20,-22);c.moveTo(-21,-10);c.quadraticCurveTo(0,-7,20,-10);c.stroke();
};
DEC.trough=function(c,t){
  contact(c,0,2,26,9,.3);
  c.fillStyle=lg(c,-24,-16,24,2,[[0,'#C4A468'],[.4,'#9C7A3A'],[1,'#5E4212']]);
  const P=(x,y)=>[(x-y)*TW/2,(x+y)*TH/2];
  poly(c,[[-26,-4],[0,-14],[26,-4],[0,8]]);c.fill();ink(c,1.6,.34);
  poly(c,[[-22,-4],[0,-12],[22,-4],[0,4]]);
  c.fillStyle=lg(c,-20,-10,20,4,[[0,'#6E4A24'],[1,'#3A2610']]);c.fill();
  c.fillStyle=lg(c,-16,-8,16,2,[[0,'#E8C98A'],[1,'#B8863A']]);
  poly(c,[[-17,-4],[0,-10],[17,-4],[0,2]]);c.fill();
};

/* ================= PARTICLES / FX ================= */
function bubble(c,t,drawIcon){
  const bob=Math.sin(t*3)*2.6;
  c.save();c.translate(0,bob);
  c.fillStyle='rgba(255,255,255,.96)';
  c.beginPath();c.moveTo(0,4);c.lineTo(-6,-4);c.lineTo(6,-4);c.closePath();c.fill();
  ell(c,0,-20,20,17);c.fill();
  c.strokeStyle='rgba(120,86,40,.35)';c.lineWidth=2;ell(c,0,-20,20,17);c.stroke();
  c.save();c.translate(-13,-33);c.scale(.42,.42);drawIcon(c);c.restore();
  c.restore();
}
function progressRing(c,p,r,col){
  c.save();
  c.strokeStyle='rgba(40,26,10,.3)';c.lineWidth=5;
  c.beginPath();c.arc(0,0,r,0,6.2832);c.stroke();
  c.strokeStyle=col||'#5FBF33';c.lineWidth=5;c.lineCap='round';
  c.beginPath();c.arc(0,0,r,-1.5708,-1.5708+6.2832*p);c.stroke();
  c.restore();
}
function progressBar(c,p,w,label){
  const h=11;
  c.save();
  c.fillStyle='rgba(255,250,236,.95)';rr(c,-w/2-3,-h/2-3,w+6,h+6,8);c.fill();
  c.strokeStyle='rgba(92,54,24,.6)';c.lineWidth=2;rr(c,-w/2-3,-h/2-3,w+6,h+6,8);c.stroke();
  c.fillStyle='rgba(92,54,24,.28)';rr(c,-w/2,-h/2,w,h,5);c.fill();
  c.fillStyle=lg(c,-w/2,-h/2,-w/2,h/2,[[0,'#9BE05F'],[1,'#3E8A1C']]);
  rr(c,-w/2,-h/2,Math.max(4,w*p),h,5);c.fill();
  c.save();c.globalAlpha=.45;c.fillStyle='#fff';rr(c,-w/2+2,-h/2+2,Math.max(2,w*p-4),3.4,2);c.fill();c.restore();
  c.restore();
}


export const W = {TW:TW,TH:TH,HZ:HZ,FL:FL,iso:iso,box:box,boxC:boxC,gable:gable,house:house,faceR:faceR,faceL:faceL,island:island,
  plot:plot,CROP:CROP,BLD:BLD,AN:AN,farmer:farmer,DEC:DEC,
  bubble:bubble,progressRing:progressRing,progressBar:progressBar,windowPane:windowPane};
