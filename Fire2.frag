#version 300 es
precision highp float;

uniform sampler2D _MainTex;
uniform float uTime;
uniform float _Scroll1;
uniform float _Scroll2;
uniform float _DisplacementIntensity;
uniform float _Dissolve;
uniform float _ClipStart;
uniform float _ClipEnd;

in vec2 vTexcoord;
in vec4 vColor;
in float vVertexID;

out vec4 fragColor;

float dither8x8(vec2 screenPos)
{
    vec2 ditherUV = screenPos * 0.25;
    return fract(sin(dot(ditherUV, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    if (_ClipEnd > 0.0 && !(vVertexID > _ClipStart && vVertexID < _ClipEnd))
        discard;

    if (_Dissolve < 1.0 && dither8x8(gl_FragCoord.xy) >= _Dissolve)
        discard;

    float timeVal = uTime / 20.0;
    vec2 scrollUV1 = vTexcoord + vec2(0.0, -timeVal * _Scroll1);
    float displacement = texture(_MainTex, scrollUV1).a;
    vec2 scrollUV2 = vTexcoord + vec2(0.0, -timeVal * _Scroll2) - vec2(displacement * _DisplacementIntensity);
    vec4 tex = texture(_MainTex, scrollUV2);
    tex.rgb *= step(vec3(0.01), tex.rgb);

    fragColor = vColor * tex * _Dissolve;
}
