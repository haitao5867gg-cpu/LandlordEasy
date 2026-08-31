import { defineStore } from 'pinia';
import { ref } from 'vue';
import http from '../utils/http';

export const usePropertyStore = defineStore('property', () => {
  const properties = ref<any[]>([]);
  const currentPropertyId = ref<number | null>(
    localStorage.getItem('current_property_id') ? Number(localStorage.getItem('current_property_id')) : null,
  );

  async function fetchProperties() {
    properties.value = (await http.get('/properties')) as any;
  }

  function setCurrentProperty(id: number | null) {
    currentPropertyId.value = id;
    if (id === null) {
      localStorage.removeItem('current_property_id');
    } else {
      localStorage.setItem('current_property_id', String(id));
    }
  }

  return { properties, currentPropertyId, fetchProperties, setCurrentProperty };
});
