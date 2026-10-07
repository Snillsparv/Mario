// Shader text shared by objects in different chunks (the robot beast's, aiRace; the critters',
// skerries).
//
//   scaledFog(scale, toBlack) -> GLSL   three.js's fog chunk with the fog factor scaled by
//                                       `scale` (GLSL); `toBlack` fades to black instead of the
//                                       fog colour (for additive sprites, which would otherwise
//                                       add the fog colour)

export function scaledFog(scale, toBlack) {
  return [
    '#ifdef USE_FOG',
    '\t#ifdef FOG_EXP2',
    '\t\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    '\t#else',
    '\t\tfloat fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
    '\t#endif',
    `\tfogFactor *= ${scale};`,
    toBlack ? '\tgl_FragColor.rgb *= 1.0 - fogFactor;' : '\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    '#endif',
  ].join('\n');
}
