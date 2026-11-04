#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec2 aTexcoord;

uniform mat4 uModelViewProjection;
uniform vec4 _MainTex_ST;
uniform vec3 _Color;
uniform float _EmissionGain;

out vec2 vTexcoord;
out vec4 vColor;
out float vVertexID;

void main()
{
    vTexcoord = aTexcoord * _MainTex_ST.xy + _MainTex_ST.zw;
    vColor = vec4(_Color * (max(0.001, _EmissionGain) * 10.0), aColor.a);
    vVertexID = float(gl_VertexID);
    gl_Position = uModelViewProjection * vec4(aPosition, 1.0);
}
