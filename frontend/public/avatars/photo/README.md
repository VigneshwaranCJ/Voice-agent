# Photo avatars

`portrait-1.jpg` (Kavya) and `portrait-2.jpg` (Amara) were supplied by the project owner, who confirmed
they hold the rights to use them in this product. `portrait-1.jpg` was resized to 933×1400 for the web.

They are rendered in 3D by `src/components/PhotoAvatar.tsx` (WebGL2). The photo becomes a mesh with depth
built from face landmarks (head, nose, eye sockets, lips, neck, chest), so the head really turns, nods
and tilts with parallax and moving light. It follows the pointer, blinks, breathes, and moves its lips
with the agent's voice. Without WebGL2 the still photo is shown. To add another portrait:

1. Put the image here (a front-facing head-and-shoulders photo, mouth closed or slightly open).
2. Add an entry to `REALISTIC_MODELS` in `src/components/RealisticAvatar.tsx` with `kind: 'photo'` and a
   `portrait` spec, all as fractions of the image's width (x, widths) and height (y, heights):
   - the lip-seam centre (`mouth`), half the mouth width (`mouthHalfWidth`), the chin bottom (`chinY`);
   - the face ellipse, forehead to chin and cheek to cheek (`head`), and the nose tip (`nose`);
   - each eye opening's centre, half width and half height (`eyes`);
   - the neck centre and half width, and where the shoulders start (`neck`);
   - the `upper` and `head` framing boxes.
