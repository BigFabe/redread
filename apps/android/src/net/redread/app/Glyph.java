package net.redread.app;

import android.graphics.*;
import android.graphics.drawable.Drawable;

/** Small vector controls, independent of emoji rendering or a device's system font. */
final class Glyph extends Drawable {
    private final Paint p = new Paint(3);
    private final String name;
    private final int color;
    Glyph(String name, int color) { this.name = name; this.color = color; }
    @Override public void draw(Canvas c) {
        c.save(); c.translate(getBounds().left,getBounds().top); c.scale(getBounds().width()/24f,getBounds().height()/24f);
        p.setColor(color); p.setStrokeWidth(1.7f); p.setStrokeCap(Paint.Cap.ROUND); p.setStrokeJoin(Paint.Join.ROUND); p.setStyle(Paint.Style.STROKE);
        Path path = new Path();
        switch(name) {
            case "play": p.setStyle(Paint.Style.FILL); path.moveTo(9,5); path.lineTo(19,12); path.lineTo(9,19); path.close(); c.drawPath(path,p); break;
            case "pause": p.setStyle(Paint.Style.FILL); c.drawRoundRect(7,5,10,19,1,1,p); c.drawRoundRect(14,5,17,19,1,1,p); break;
            case "plus": c.drawLine(12,5,12,19,p); c.drawLine(5,12,19,12,p); break;
            case "close": c.drawLine(6,6,18,18,p); c.drawLine(18,6,6,18,p); break;
            case "down": path.moveTo(6,9); path.lineTo(12,15); path.lineTo(18,9); c.drawPath(path,p); break;
            case "search": c.drawCircle(10.5f,10.5f,6,p); c.drawLine(15,15,20,20,p); break;
            case "settings": c.drawLine(4,7,20,7,p); c.drawLine(4,17,20,17,p); p.setStyle(Paint.Style.FILL); c.drawCircle(9,7,3,p); c.drawCircle(15,17,3,p); break;
            case "refresh": c.drawArc(4,4,20,20,35,280,false,p); path.moveTo(19,3); path.lineTo(20,9); path.lineTo(14,8); c.drawPath(path,p); break;
            case "wave": for(int i=0;i<5;i++) { float h = new float[]{5,12,19,12,5}[i]; c.drawLine(4+i*4,12-h/2,4+i*4,12+h/2,p); } break;
            case "back": case "forward":
                boolean back = name.equals("back"); c.drawArc(3,4,21,22,back ? -40 : -140,back ? 285 : -285,false,p);
                path.moveTo(back?4:20,2); path.lineTo(back?4:20,8); path.lineTo(back?10:14,8); c.drawPath(path,p);
                p.setStyle(Paint.Style.FILL); p.setTypeface(Typeface.create("sans-serif-medium",0)); p.setTextSize(8); p.setTextAlign(Paint.Align.CENTER); c.drawText(back?"15":"30",12,16,p); p.setTextAlign(Paint.Align.LEFT); break;
        }
        c.restore();
    }
    @Override public void setAlpha(int a) { p.setAlpha(a); }
    @Override public void setColorFilter(ColorFilter f) { p.setColorFilter(f); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}
