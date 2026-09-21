package net.redread.app;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** Deterministic episode artwork: the same article has the same visual identity everywhere. */
final class Artwork extends View {
    private final Paint paint = new Paint(3);
    private final int seed;
    private final boolean large;
    private final String source;
    private static final int[] PAPER = {0xffefe8f4, 0xffe5eee9, 0xfff6e7e5, 0xffe6ecf7, 0xfff0eddf};
    private static final int[] TINT = {0xff9480ab, 0xff729884, 0xffc78b86, 0xff7b90b8, 0xffa59763};
    Artwork(Context context, String id, String source, boolean large) {
        super(context); this.seed = id.hashCode() & 0x7fffffff; this.source = source; this.large = large;
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth(), h = getHeight(), radius = Math.min(w,h) * .19f;
        paint.setColor(PAPER[seed % PAPER.length]); canvas.drawRoundRect(0, 0, w, h, radius, radius, paint);
        canvas.save(); Path clip = new Path(); clip.addRoundRect(0,0,w,h,radius,radius,Path.Direction.CW); canvas.clipPath(clip);
        paint.setColor(TINT[seed % TINT.length]); paint.setAlpha(14);
        canvas.drawCircle(w*.92f, h*.13f, w*.65f, paint); canvas.drawCircle(w*.1f,h*1.12f,w*.73f,paint);
        paint.setAlpha(255);
        int bars = large ? 35 : 13;
        float left = w*.16f, gap = w*.68f/bars, center = h*(large ? .50f : .5f);
        for (int i=0; i<bars; i++) {
            double wave = Math.abs(Math.sin((i + seed%13)*.71) * Math.cos(i*.29));
            float height = h*(.08f + (float)wave*.37f);
            paint.setColor(TINT[seed % TINT.length]); paint.setAlpha(large ? 150 : 190);
            canvas.drawRoundRect(left+i*gap,center-height/2,left+i*gap+gap*.43f,center+height/2,gap,gap,paint);
        }
        if (large) {
            paint.setAlpha(255); paint.setColor(TINT[seed % TINT.length]);
            paint.setTypeface(Typeface.create("sans-serif-medium", 0)); paint.setTextSize(w*.038f);
            canvas.drawText("REDREAD  /  AUDIO",w*.09f,h*.13f,paint);
            paint.setTextSize(w*.043f); canvas.drawText(source,w*.09f,h*.90f,paint);
        }
        paint.setAlpha(255); canvas.restore();
    }
}
